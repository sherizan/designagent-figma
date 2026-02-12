import type {
  LayoutSummary,
  TextSummary,
  TokenHints,
  UiNodeSpec,
  UiSpec,
  UiSpecStats,
  VisualSummary
} from './types';

interface MutableStats extends UiSpecStats {
  styleRefs: number;
  variableRefs: number;
  rawValueCandidates: number;
}

function isMixed<T>(value: T | PluginAPI['mixed']): value is PluginAPI['mixed'] {
  return value === figma.mixed;
}

function summarizeFills(
  fills: ReadonlyArray<Paint> | PluginAPI['mixed'] | undefined
): VisualSummary['fills'] {
  if (!fills) {
    return 'unknown';
  }

  if (isMixed(fills)) {
    return 'mixed';
  }

  const visible = fills.filter((paint) => paint.visible !== false);
  if (visible.length === 0) {
    return 'none';
  }

  const paintTypes = new Set(visible.map((paint) => paint.type));

  if (paintTypes.size === 1 && paintTypes.has('SOLID')) {
    return 'solid';
  }

  if ([...paintTypes].every((type) => type.includes('GRADIENT'))) {
    return 'gradient';
  }

  if (paintTypes.has('IMAGE')) {
    return 'image';
  }

  return 'mixed';
}

function summarizeStrokes(
  strokes: ReadonlyArray<Paint> | PluginAPI['mixed'] | undefined
): VisualSummary['strokes'] {
  if (!strokes) {
    return 'unknown';
  }

  if (isMixed(strokes)) {
    return 'mixed';
  }

  const visible = strokes.filter((paint) => paint.visible !== false);
  if (visible.length === 0) {
    return 'none';
  }

  const paintTypes = new Set(visible.map((paint) => paint.type));
  if (paintTypes.size === 1 && paintTypes.has('SOLID')) {
    return 'solid';
  }

  return 'mixed';
}

function summarizeEffects(
  effects: ReadonlyArray<Effect> | PluginAPI['mixed'] | undefined
): VisualSummary['effects'] {
  if (!effects) {
    return 'none';
  }

  if (isMixed(effects)) {
    return 'mixed';
  }

  const visible = effects.filter((effect) => effect.visible !== false);
  if (visible.length === 0) {
    return 'none';
  }

  const effectTypes = new Set(visible.map((effect) => effect.type));
  const shadowOnly = [...effectTypes].every(
    (type) => type === 'DROP_SHADOW' || type === 'INNER_SHADOW'
  );
  if (shadowOnly) {
    return 'shadow';
  }

  const blurOnly = [...effectTypes].every(
    (type) => type === 'LAYER_BLUR' || type === 'BACKGROUND_BLUR'
  );
  if (blurOnly) {
    return 'blur';
  }

  return 'mixed';
}

function summarizeCornerRadius(node: SceneNode): VisualSummary['cornerRadius'] {
  if ('cornerRadius' in node) {
    if (typeof node.cornerRadius === 'number') {
      return node.cornerRadius;
    }

    if (isMixed(node.cornerRadius)) {
      return 'mixed';
    }
  }

  if (
    'topLeftRadius' in node &&
    'topRightRadius' in node &&
    'bottomLeftRadius' in node &&
    'bottomRightRadius' in node
  ) {
    const values = [
      node.topLeftRadius,
      node.topRightRadius,
      node.bottomLeftRadius,
      node.bottomRightRadius
    ];

    const [first = 0] = values;
    const allEqual = values.every((value) => value === first);
    return allEqual ? first : 'mixed';
  }

  return 'undefined';
}

function extractLayout(node: SceneNode): LayoutSummary | undefined {
  const layout: LayoutSummary = {};
  let hasAny = false;

  if ('layoutMode' in node) {
    layout.layoutMode = node.layoutMode;
    layout.primaryAxisAlignItems = node.primaryAxisAlignItems;
    layout.counterAxisAlignItems = node.counterAxisAlignItems;
    layout.itemSpacing = node.itemSpacing;
    layout.paddingTop = node.paddingTop;
    layout.paddingRight = node.paddingRight;
    layout.paddingBottom = node.paddingBottom;
    layout.paddingLeft = node.paddingLeft;
    hasAny = true;
  }

  if ('layoutPositioning' in node) {
    layout.layoutPositioning = node.layoutPositioning;
    hasAny = true;
  }

  if ('constraints' in node) {
    layout.constraints = {
      horizontal: node.constraints.horizontal,
      vertical: node.constraints.vertical
    };
    hasAny = true;
  }

  return hasAny ? layout : undefined;
}

function lineHeightToString(lineHeight: TextNode['lineHeight']): string | undefined {
  if (isMixed(lineHeight)) {
    return 'MIXED';
  }

  if (lineHeight.unit === 'AUTO') {
    return 'AUTO';
  }

  const suffix = lineHeight.unit === 'PIXELS' ? 'px' : '%';
  return `${lineHeight.value}${suffix}`;
}

function letterSpacingToString(
  letterSpacing: TextNode['letterSpacing']
): string | undefined {
  if (isMixed(letterSpacing)) {
    return 'MIXED';
  }

  const suffix = letterSpacing.unit === 'PIXELS' ? 'px' : '%';
  return `${letterSpacing.value}${suffix}`;
}

function extractTextSummary(node: SceneNode): TextSummary | undefined {
  if (node.type !== 'TEXT') {
    return undefined;
  }

  const summary: TextSummary = {
    characters: node.characters,
    lineHeight: lineHeightToString(node.lineHeight),
    letterSpacing: letterSpacingToString(node.letterSpacing),
    textCase: isMixed(node.textCase) ? 'MIXED' : node.textCase
  };

  if (!isMixed(node.fontName)) {
    summary.fontFamily = node.fontName.family;
    summary.fontStyle = node.fontName.style;
  }

  if (typeof node.fontSize === 'number') {
    summary.fontSize = node.fontSize;
  }

  return summary;
}

function extractInstanceSummary(node: SceneNode) {
  if (node.type !== 'INSTANCE') {
    return undefined;
  }

  const props: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(node.componentProperties ?? {})) {
    props[key] = value.value as string | number | boolean;
  }

  return {
    mainComponentName: node.mainComponent?.name,
    mainComponentKey: node.mainComponent?.key,
    componentProperties: Object.keys(props).length > 0 ? props : undefined
  };
}

function countVariableBindings(value: unknown): number {
  if (value == null) {
    return 0;
  }

  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + countVariableBindings(item), 0);
  }

  if (typeof value !== 'object') {
    return 0;
  }

  const maybeBinding = value as { id?: unknown };
  let count = 0;
  if (typeof maybeBinding.id === 'string' && maybeBinding.id.length > 0) {
    count += 1;
  }

  for (const nested of Object.values(value as Record<string, unknown>)) {
    count += countVariableBindings(nested);
  }

  return count;
}

function getNodeStyleRefCount(node: SceneNode): number {
  let refs = 0;

  if ('fillStyleId' in node && typeof node.fillStyleId === 'string' && node.fillStyleId.length > 0) {
    refs += 1;
  }

  if (
    'strokeStyleId' in node &&
    typeof node.strokeStyleId === 'string' &&
    node.strokeStyleId.length > 0
  ) {
    refs += 1;
  }

  if (
    'effectStyleId' in node &&
    typeof node.effectStyleId === 'string' &&
    node.effectStyleId.length > 0
  ) {
    refs += 1;
  }

  if ('textStyleId' in node && typeof node.textStyleId === 'string' && node.textStyleId.length > 0) {
    refs += 1;
  }

  return refs;
}

function getNodeVariableRefCount(node: SceneNode): number {
  let refs = 0;

  if ('boundVariables' in node) {
    refs += countVariableBindings(node.boundVariables);
  }

  const paintCollections: Array<ReadonlyArray<Paint> | PluginAPI['mixed'] | undefined> = [];
  if ('fills' in node) {
    paintCollections.push(node.fills);
  }
  if ('strokes' in node) {
    paintCollections.push(node.strokes);
  }

  for (const collection of paintCollections) {
    if (!collection || isMixed(collection)) {
      continue;
    }

    for (const paint of collection) {
      refs += countVariableBindings((paint as Paint & { boundVariables?: unknown }).boundVariables);
    }
  }

  return refs;
}

function countRawValueHints(node: SceneNode): number {
  let raw = 0;

  const hasFillStyle = 'fillStyleId' in node && typeof node.fillStyleId === 'string';
  if ('fills' in node && !hasFillStyle && !isMixed(node.fills)) {
    for (const paint of node.fills) {
      const paintHasVariable =
        countVariableBindings((paint as Paint & { boundVariables?: unknown }).boundVariables) > 0;
      if (paint.visible !== false && paint.type === 'SOLID' && !paintHasVariable) {
        raw += 1;
      }
    }
  }

  const hasStrokeStyle = 'strokeStyleId' in node && typeof node.strokeStyleId === 'string';
  if ('strokes' in node && !hasStrokeStyle && !isMixed(node.strokes)) {
    for (const paint of node.strokes) {
      const paintHasVariable =
        countVariableBindings((paint as Paint & { boundVariables?: unknown }).boundVariables) > 0;
      if (paint.visible !== false && paint.type === 'SOLID' && !paintHasVariable) {
        raw += 1;
      }
    }
  }

  if (
    node.type === 'TEXT' &&
    !(typeof node.textStyleId === 'string' && node.textStyleId.length > 0) &&
    countVariableBindings(node.boundVariables) === 0
  ) {
    raw += 1;
  }

  return raw;
}

function extractVisualSummary(node: SceneNode): VisualSummary | undefined {
  if (!('fills' in node || 'strokes' in node || 'effects' in node || 'cornerRadius' in node)) {
    return undefined;
  }

  return {
    fills: 'fills' in node ? summarizeFills(node.fills) : 'unknown',
    strokes: 'strokes' in node ? summarizeStrokes(node.strokes) : 'unknown',
    cornerRadius: summarizeCornerRadius(node),
    effects: 'effects' in node ? summarizeEffects(node.effects) : 'none'
  };
}

function updateGlobalStats(node: SceneNode, stats: MutableStats, tokenHints: TokenHints): void {
  stats.totalNodes += 1;

  if (node.type === 'FRAME') {
    stats.frames += 1;
  }

  if (node.type === 'INSTANCE') {
    stats.instances += 1;
  }

  if (node.type === 'TEXT') {
    stats.textNodes += 1;
  }

  if ('layoutMode' in node && node.layoutMode !== 'NONE') {
    stats.autoLayoutFrames += 1;
  }

  if ('layoutPositioning' in node && node.layoutPositioning === 'ABSOLUTE') {
    stats.absoluteNodes += 1;
  }

  stats.styleRefs += tokenHints.styleRefs;
  stats.variableRefs += tokenHints.variableRefs;
  stats.rawValueCandidates += tokenHints.rawValueHints;
}

function extractNode(node: SceneNode, stats: MutableStats): UiNodeSpec {
  const tokenHints: TokenHints = {
    styleRefs: getNodeStyleRefCount(node),
    variableRefs: getNodeVariableRefCount(node),
    rawValueHints: countRawValueHints(node)
  };

  updateGlobalStats(node, stats, tokenHints);

  const spec: UiNodeSpec = {
    id: node.id,
    name: node.name,
    type: node.type,
    visible: node.visible,
    tokenHints,
    children: []
  };

  if ('width' in node) {
    spec.width = node.width;
  }

  if ('height' in node) {
    spec.height = node.height;
  }

  const layout = extractLayout(node);
  if (layout) {
    spec.layout = layout;
  }

  const visual = extractVisualSummary(node);
  if (visual) {
    spec.visual = visual;
  }

  const text = extractTextSummary(node);
  if (text) {
    spec.text = text;
  }

  const instance = extractInstanceSummary(node);
  if (instance) {
    spec.instance = instance;
  }

  if ('children' in node) {
    spec.children = node.children.map((child) => extractNode(child, stats));
  }

  return spec;
}

export function extractUiSpec(root: SceneNode): UiSpec {
  const stats: MutableStats = {
    totalNodes: 0,
    frames: 0,
    instances: 0,
    textNodes: 0,
    autoLayoutFrames: 0,
    absoluteNodes: 0,
    styleRefs: 0,
    variableRefs: 0,
    rawValueCandidates: 0
  };

  const rootSpec = extractNode(root, stats);

  const tokenRefs = stats.styleRefs + stats.variableRefs;
  const totalTokenSignals = tokenRefs + stats.rawValueCandidates;
  const coverage = totalTokenSignals > 0 ? tokenRefs / totalTokenSignals : 0.5;

  return {
    version: '1.0.0',
    root: rootSpec,
    stats: {
      totalNodes: stats.totalNodes,
      frames: stats.frames,
      instances: stats.instances,
      textNodes: stats.textNodes,
      autoLayoutFrames: stats.autoLayoutFrames,
      absoluteNodes: stats.absoluteNodes
    },
    tokenization: {
      styleRefs: stats.styleRefs,
      variableRefs: stats.variableRefs,
      rawValueCandidates: stats.rawValueCandidates,
      coverage: Number(coverage.toFixed(3))
    }
  };
}
