import type {
  AnnotationEntry,
  LayoutSummary,
  ResolvedVariable,
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

const GHOST_NAME_PATTERN = /\b(ghost|hidden)\b/i;

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
    // INSTANCE_SWAP props resolve to opaque node IDs (e.g. "1347:1015") that
    // are useless to a code-generating agent. Drop them.
    if (value.type === 'INSTANCE_SWAP') {
      continue;
    }
    // Component-property keys come as "Label#1234:0" — strip the trailing
    // disambiguation suffix so prompts read cleanly.
    const cleanKey = key.split('#')[0] ?? key;
    props[cleanKey] = value.value as string | number | boolean;
  }

  // mainComponent is resolved asynchronously in enrichUiSpec because the
  // plugin uses documentAccess: "dynamic-page", which forbids the sync getter.
  return {
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

function shouldIgnoreForTokenScoring(node: SceneNode): boolean {
  return !node.visible || GHOST_NAME_PATTERN.test(node.name);
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
  const tokenHints: TokenHints = shouldIgnoreForTokenScoring(node)
    ? { styleRefs: 0, variableRefs: 0, rawValueHints: 0 }
    : {
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

function collectVariableIds(value: unknown, out: Set<string>): void {
  if (value == null) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectVariableIds(item, out);
    }
    return;
  }

  if (typeof value !== 'object') {
    return;
  }

  const maybeBinding = value as { id?: unknown; type?: unknown };
  if (
    typeof maybeBinding.id === 'string' &&
    maybeBinding.id.length > 0 &&
    maybeBinding.type === 'VARIABLE_ALIAS'
  ) {
    out.add(maybeBinding.id);
    return;
  }

  if (typeof maybeBinding.id === 'string' && maybeBinding.id.startsWith('VariableID:')) {
    out.add(maybeBinding.id);
    return;
  }

  for (const nested of Object.values(value as Record<string, unknown>)) {
    collectVariableIds(nested, out);
  }
}

function collectVariableIdsFromNode(node: SceneNode, out: Set<string>): void {
  if ('boundVariables' in node) {
    collectVariableIds(node.boundVariables, out);
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
      collectVariableIds((paint as Paint & { boundVariables?: unknown }).boundVariables, out);
    }
  }
}

function rgbToHex(color: RGB | RGBA): string {
  const toHex = (value: number): string => {
    const clamped = Math.max(0, Math.min(255, Math.round(value * 255)));
    return clamped.toString(16).padStart(2, '0');
  };
  const hex = `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
  if ('a' in color && color.a !== 1) {
    return `${hex} (alpha ${Number(color.a.toFixed(2))})`;
  }
  return hex;
}

function formatVariableValue(value: VariableValue, resolvedType: string): string {
  if (value == null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return resolvedType === 'FLOAT' ? String(Math.round(value * 1000) / 1000) : String(value);
  }
  if (typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'object' && 'r' in value && 'g' in value && 'b' in value) {
    return rgbToHex(value as RGBA);
  }
  if (typeof value === 'object' && 'type' in value && (value as { type: string }).type === 'VARIABLE_ALIAS') {
    return `→ alias(${(value as { id: string }).id})`;
  }
  return JSON.stringify(value);
}

function isVariableAlias(value: unknown): value is { type: 'VARIABLE_ALIAS'; id: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'VARIABLE_ALIAS' &&
    typeof (value as { id?: unknown }).id === 'string'
  );
}

function pickAliasedModeId(
  collection: VariableCollection | null,
  preferredModeName: string
): string | undefined {
  if (!collection) {
    return undefined;
  }
  const lower = preferredModeName.toLowerCase();
  const byName = collection.modes.find((mode) => mode.name.toLowerCase() === lower);
  if (byName) {
    return byName.modeId;
  }
  return collection.defaultModeId ?? collection.modes[0]?.modeId;
}

const MAX_ALIAS_DEPTH = 8;

export async function resolveVariablesForNode(
  root: SceneNode,
  maxNodes = 400
): Promise<ResolvedVariable[]> {
  const ids = new Set<string>();
  const queue: SceneNode[] = [root];
  let visited = 0;
  while (queue.length > 0 && visited < maxNodes) {
    const node = queue.shift();
    if (!node) {
      continue;
    }
    visited += 1;
    collectVariableIdsFromNode(node, ids);
    if ('children' in node) {
      for (const child of node.children) {
        queue.push(child);
      }
    }
  }

  if (ids.size === 0) {
    return [];
  }

  const variableCache = new Map<string, Variable | null>();
  async function loadVariable(id: string): Promise<Variable | null> {
    if (variableCache.has(id)) {
      return variableCache.get(id) ?? null;
    }
    const variable = await figma.variables.getVariableByIdAsync(id).catch(() => null);
    variableCache.set(id, variable);
    return variable;
  }

  const collectionsCache = new Map<string, VariableCollection | null>();
  async function getCollection(id: string): Promise<VariableCollection | null> {
    if (collectionsCache.has(id)) {
      return collectionsCache.get(id) ?? null;
    }
    const collection = await figma.variables.getVariableCollectionByIdAsync(id).catch(() => null);
    collectionsCache.set(id, collection);
    return collection;
  }

  async function resolveAliasChain(
    value: VariableValue,
    preferredModeName: string,
    visitedAliases: Set<string>,
    depth: number
  ): Promise<{ terminal: VariableValue | null; resolvedType: string | null }> {
    if (depth > MAX_ALIAS_DEPTH) {
      return { terminal: null, resolvedType: null };
    }
    if (!isVariableAlias(value)) {
      return { terminal: value, resolvedType: null };
    }
    if (visitedAliases.has(value.id)) {
      return { terminal: null, resolvedType: null };
    }
    visitedAliases.add(value.id);

    const aliased = await loadVariable(value.id);
    if (!aliased) {
      return { terminal: null, resolvedType: null };
    }
    const aliasedCollection = await getCollection(aliased.variableCollectionId);
    const modeId = pickAliasedModeId(aliasedCollection, preferredModeName);
    if (!modeId) {
      return { terminal: null, resolvedType: aliased.resolvedType };
    }
    const nextValue = aliased.valuesByMode[modeId];
    if (nextValue === undefined) {
      return { terminal: null, resolvedType: aliased.resolvedType };
    }
    const downstream = await resolveAliasChain(
      nextValue,
      preferredModeName,
      visitedAliases,
      depth + 1
    );
    return {
      terminal: downstream.terminal,
      resolvedType: downstream.resolvedType ?? aliased.resolvedType
    };
  }

  const seeds = await Promise.all(Array.from(ids).map(loadVariable));

  const resolved: ResolvedVariable[] = [];
  for (const variable of seeds) {
    if (!variable) {
      continue;
    }
    const collection = await getCollection(variable.variableCollectionId);
    const modeNames = new Map<string, string>();
    if (collection) {
      for (const mode of collection.modes) {
        modeNames.set(mode.modeId, mode.name);
      }
    }

    const modes: Record<string, string> = {};
    for (const [modeId, rawValue] of Object.entries(variable.valuesByMode)) {
      const modeName = modeNames.get(modeId) ?? modeId;
      if (isVariableAlias(rawValue)) {
        const { terminal, resolvedType } = await resolveAliasChain(
          rawValue as VariableValue,
          modeName,
          new Set<string>(),
          0
        );
        modes[modeName] =
          terminal !== null
            ? formatVariableValue(terminal, resolvedType ?? variable.resolvedType)
            : 'unresolved';
      } else {
        modes[modeName] = formatVariableValue(rawValue as VariableValue, variable.resolvedType);
      }
    }

    resolved.push({
      id: variable.id,
      name: variable.name,
      collection: collection?.name ?? 'unknown',
      resolvedType: variable.resolvedType,
      modes
    });
  }

  resolved.sort((a, b) => a.name.localeCompare(b.name));
  return resolved;
}

type AnnotationCategoryLookup = Map<string, string>;

export async function loadAnnotationCategories(): Promise<AnnotationCategoryLookup> {
  const lookup: AnnotationCategoryLookup = new Map();
  if (!figma.annotations) {
    return lookup;
  }
  try {
    const categories = await figma.annotations.getAnnotationCategoriesAsync();
    for (const category of categories) {
      lookup.set(category.id, category.label);
    }
  } catch {
    // Annotations API may not be available; ignore.
  }
  return lookup;
}

function extractAnnotationsForNode(
  node: SceneNode,
  categories: AnnotationCategoryLookup
): AnnotationEntry[] | undefined {
  if (!('annotations' in node)) {
    return undefined;
  }
  const list = (node as SceneNode & AnnotationsMixin).annotations;
  if (!list || list.length === 0) {
    return undefined;
  }
  const entries: AnnotationEntry[] = [];
  for (const annotation of list) {
    const label = (annotation.label ?? '').trim();
    if (!label) {
      continue;
    }
    const entry: AnnotationEntry = { label };
    if (annotation.categoryId) {
      const categoryName = categories.get(annotation.categoryId);
      if (categoryName) {
        entry.category = categoryName;
      }
    }
    if (annotation.properties && annotation.properties.length > 0) {
      const props: Record<string, string> = {};
      for (const prop of annotation.properties) {
        props[prop.type] = String((prop as { value?: unknown }).value ?? '');
      }
      if (Object.keys(props).length > 0) {
        entry.properties = props;
      }
    }
    entries.push(entry);
  }
  return entries.length > 0 ? entries : undefined;
}

function getNodeDevStatus(node: SceneNode): UiNodeSpec['devStatus'] {
  if (!('devStatus' in node)) {
    return undefined;
  }
  const status = (node as SceneNode & { devStatus?: { type?: string } | null }).devStatus;
  if (!status || !status.type) {
    return undefined;
  }
  if (status.type === 'READY_FOR_DEV' || status.type === 'COMPLETED' || status.type === 'NONE') {
    return status.type;
  }
  return undefined;
}

const CSS_KEYS_OF_INTEREST = new Set([
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'gap',
  'row-gap',
  'column-gap',
  'display',
  'flex-direction',
  'align-items',
  'justify-content',
  'background',
  'background-color',
  'background-image',
  'border',
  'border-radius',
  'box-shadow',
  'opacity',
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-transform'
]);

function compactCss(css: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(css)) {
    if (CSS_KEYS_OF_INTEREST.has(key) && value && value !== 'none' && value !== '0px') {
      out[key] = value;
    }
  }
  return out;
}

export interface EnrichOptions {
  attachCssTo?: 'all' | 'leaves-and-text';
  categories?: AnnotationCategoryLookup;
  maxNodesForCss?: number;
}

export async function enrichUiSpec(
  spec: UiSpec,
  root: SceneNode,
  options: EnrichOptions = {}
): Promise<UiSpec> {
  const categories = options.categories ?? (await loadAnnotationCategories());
  const maxNodesForCss = options.maxNodesForCss ?? 120;
  let cssBudget = maxNodesForCss;

  async function walk(specNode: UiNodeSpec, sceneNode: SceneNode): Promise<void> {
    const annotations = extractAnnotationsForNode(sceneNode, categories);
    if (annotations) {
      specNode.annotations = annotations;
    }

    const devStatus = getNodeDevStatus(sceneNode);
    if (devStatus) {
      specNode.devStatus = devStatus;
    }

    if (sceneNode.type === 'INSTANCE' && specNode.instance) {
      try {
        const main = await sceneNode.getMainComponentAsync();
        if (main) {
          // If the component is a variant inside a COMPONENT_SET, the set's
          // name is the canonical component name; the variant name is just a
          // serialised property string like "Type=top navigation".
          const parent = main.parent;
          const displayName =
            parent && parent.type === 'COMPONENT_SET' ? parent.name : main.name;
          specNode.instance.mainComponentName = displayName;
          specNode.instance.mainComponentKey = main.key;
        }
      } catch {
        // main component may be inaccessible (deleted, library not loaded); skip
      }
    }

    if (cssBudget > 0 && 'getCSSAsync' in sceneNode) {
      const sceneChildren = 'children' in sceneNode ? sceneNode.children : undefined;
      const shouldAttach =
        options.attachCssTo === 'all' ||
        !sceneChildren ||
        sceneChildren.length === 0 ||
        sceneNode.type === 'TEXT' ||
        sceneNode.type === 'INSTANCE' ||
        sceneNode.type === 'FRAME' ||
        sceneNode.type === 'COMPONENT' ||
        sceneNode.type === 'COMPONENT_SET';
      if (shouldAttach) {
        cssBudget -= 1;
        try {
          const css = await sceneNode.getCSSAsync();
          const compact = compactCss(css);
          if (Object.keys(compact).length > 0) {
            specNode.css = compact;
          }
        } catch {
          // ignore per-node failures
        }
      }
    }

    if ('children' in sceneNode) {
      const sceneChildren = sceneNode.children;
      for (let i = 0; i < specNode.children.length; i += 1) {
        const childSpec = specNode.children[i];
        const childScene = sceneChildren[i];
        if (childSpec && childScene) {
          await walk(childSpec, childScene);
        }
      }
    }
  }

  await walk(spec.root, root);

  try {
    const resolvedVariables = await resolveVariablesForNode(root);
    if (resolvedVariables.length > 0) {
      spec.tokenization.resolvedVariables = resolvedVariables;
    }
  } catch {
    // Variables API may be unavailable in some files; skip silently.
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
    version: '1.1.0',
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
