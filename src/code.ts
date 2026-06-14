import {
  analyzeNodeCoreAsync,
  composeAnalysisPayload,
  type AnalysisCore
} from './core/analyze';
import { generateDesignDoc, type DesignDocFrame } from './core/designdoc';
import { loadAnnotationCategories } from './core/extract';
import { isScreenLikeNode } from './core/intent';
import type { EmptyAnalysis, Mode, Preset } from './core/types';
import { PRESET_DEFINITIONS } from './core/types';
import type { ToPluginMessage, ToUIMessage } from './shared/messages';

const DEFAULT_PRESET: Preset = 'swiftui-ios';
const DEFAULT_MODE: Mode = 'system-first';
const PANEL_SIZE = {
  width: 560,
  height: 760
};

interface AnalysisCache {
  selectionSignature: string;
  primaryNodeId: string;
  linkBase?: string;
  core: AnalysisCore;
}

let activePreset: Preset = DEFAULT_PRESET;
let activeMode: Mode = DEFAULT_MODE;
let fallbackLinkBase: string | undefined;
let cache: AnalysisCache | null = null;
let annotationCategoryId: string | undefined;
let activeAnalysisToken = 0;
let lastFocusedNodeId: string | undefined;

function parseFigmaLinkBase(input: string): string | undefined {
  const value = input.trim();
  if (!value) {
    return undefined;
  }

  const base = value.split(/[?#]/)[0];
  if (!base) {
    return undefined;
  }

  if (!/^https:\/\/www\.figma\.com\/(design|file)\//.test(base)) {
    return undefined;
  }

  return base;
}

function toEmptyAnalysis(preset: Preset, mode: Mode, message?: string): EmptyAnalysis {
  return {
    hasSelection: false,
    preset,
    mode,
    flowCapable: false,
    message: message ?? 'Select a frame, instance or section.'
  };
}

function postToUI(message: ToUIMessage): void {
  figma.ui.postMessage(message);
}

function getSelectionSignature(selection: readonly SceneNode[]): string {
  return selection
    .map((node) => node.id)
    .sort((a, b) => a.localeCompare(b))
    .join('|');
}

function hasPrototypeLinkReaction(node: SceneNode): boolean {
  if (!('reactions' in node)) {
    return false;
  }

  for (const reaction of node.reactions) {
    const actions = reaction.actions ?? (reaction.action ? [reaction.action] : []);
    for (const action of actions) {
      if (action.type === 'NODE' && action.destinationId) {
        return true;
      }
    }
  }

  return false;
}

function hasAtLeastTwoScreenLikeChildFrames(node: SceneNode): boolean {
  if (!('children' in node)) {
    return false;
  }

  let count = 0;
  for (const child of node.children) {
    if (child.type === 'FRAME' && isScreenLikeNode(child)) {
      count += 1;
      if (count >= 2) {
        return true;
      }
    }
  }

  return false;
}

function detectFlowCapable(selection: readonly SceneNode[]): boolean {
  if (selection.length >= 2) {
    const screenLikeFrames = selection.filter(
      (node) => node.type === 'FRAME' && isScreenLikeNode(node)
    );
    if (screenLikeFrames.length >= 2) {
      return true;
    }
  }

  const selectedNode = selection[0];
  if (!selectedNode) {
    return false;
  }

  if (hasAtLeastTwoScreenLikeChildFrames(selectedNode)) {
    return true;
  }

  if (selectedNode.type === 'FRAME' && hasPrototypeLinkReaction(selectedNode)) {
    return true;
  }

  return false;
}

function invalidateCache(): void {
  cache = null;
}

function isEmptyFrameSelection(node: SceneNode): boolean {
  return node.type === 'FRAME' && node.children.length === 0;
}

function isSceneNode(node: BaseNode | null): node is SceneNode {
  return Boolean(
    node &&
      node.type !== 'DOCUMENT' &&
      node.type !== 'PAGE' &&
      node.type !== 'SLICE'
  );
}

function hasAnnotationsMixin(node: SceneNode): node is SceneNode & AnnotationsMixin {
  return 'annotations' in node;
}

function buildAnnotationText(message: {
  nodeName: string;
  category: string;
  reason: string;
  suggestion: string;
}): string {
  return [
    `Issue: ${message.reason}`,
    `Action: ${message.suggestion}`
  ].join('\n');
}

function isLayoutContainerNode(
  node: SceneNode
): node is SceneNode &
  ChildrenMixin &
  {
    layoutMode: FrameNode['layoutMode'];
    primaryAxisAlignItems: FrameNode['primaryAxisAlignItems'];
    counterAxisAlignItems: FrameNode['counterAxisAlignItems'];
    itemSpacing: number;
    paddingTop: number;
    paddingRight: number;
    paddingBottom: number;
    paddingLeft: number;
    width: number;
    height: number;
  } {
  return 'children' in node && 'layoutMode' in node;
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    const left = sorted[mid - 1] ?? 0;
    const right = sorted[mid] ?? left;
    return (left + right) / 2;
  }
  return sorted[mid] ?? 0;
}

function detectCounterAxisAlignment(
  parent: { width: number; height: number },
  children: readonly SceneNode[],
  axis: 'VERTICAL' | 'HORIZONTAL'
): FrameNode['counterAxisAlignItems'] {
  if (axis === 'VERTICAL') {
    const lefts = children.map((child) => child.x);
    const rights = children.map((child) => child.x + ('width' in child ? child.width : 0));
    const centers = children.map((child) => child.x + ('width' in child ? child.width / 2 : 0));
    const leftSpread = Math.max(...lefts) - Math.min(...lefts);
    const rightSpread = Math.max(...rights) - Math.min(...rights);
    const centerError = Math.max(...centers.map((value) => Math.abs(value - parent.width / 2)));

    if (leftSpread <= 4) {
      return 'MIN';
    }
    if (rightSpread <= 4) {
      return 'MAX';
    }
    if (centerError <= 4) {
      return 'CENTER';
    }
    return 'MIN';
  }

  const tops = children.map((child) => child.y);
  const bottoms = children.map((child) => child.y + ('height' in child ? child.height : 0));
  const centers = children.map((child) => child.y + ('height' in child ? child.height / 2 : 0));
  const topSpread = Math.max(...tops) - Math.min(...tops);
  const bottomSpread = Math.max(...bottoms) - Math.min(...bottoms);
  const centerError = Math.max(...centers.map((value) => Math.abs(value - parent.height / 2)));

  if (topSpread <= 4) {
    return 'MIN';
  }
  if (bottomSpread <= 4) {
    return 'MAX';
  }
  if (centerError <= 4) {
    return 'CENTER';
  }
  return 'MIN';
}

function detectStackAxis(children: readonly SceneNode[]): 'VERTICAL' | 'HORIZONTAL' | null {
  if (children.length < 2) {
    return null;
  }

  const centerXs = children.map((child) => child.x + ('width' in child ? child.width / 2 : 0));
  const centerYs = children.map((child) => child.y + ('height' in child ? child.height / 2 : 0));
  const xSpread = Math.max(...centerXs) - Math.min(...centerXs);
  const ySpread = Math.max(...centerYs) - Math.min(...centerYs);

  const verticalLikely = xSpread <= 12 && ySpread > 12;
  const horizontalLikely = ySpread <= 12 && xSpread > 12;

  if (verticalLikely && !horizontalLikely) {
    return 'VERTICAL';
  }
  if (horizontalLikely && !verticalLikely) {
    return 'HORIZONTAL';
  }
  return null;
}

function canSafelyConvertToAutoLayout(node: SceneNode): boolean {
  if (!isLayoutContainerNode(node)) {
    return false;
  }
  if (node.children.length < 2) {
    return false;
  }
  for (const child of node.children) {
    if (!child.visible) {
      continue;
    }
    if ('rotation' in child && Math.abs(child.rotation) > 0.1) {
      return false;
    }
    if (!('width' in child) || !('height' in child)) {
      return false;
    }
  }
  return true;
}

function applyAutoLayoutFix(node: SceneNode): { ok: boolean; message: string } {
  if (!canSafelyConvertToAutoLayout(node)) {
    return {
      ok: false,
      message: 'Auto Layout fix skipped: container is ambiguous or has unsupported children.'
    };
  }

  const container = node as SceneNode &
    ChildrenMixin &
    {
      layoutMode: FrameNode['layoutMode'];
      primaryAxisAlignItems: FrameNode['primaryAxisAlignItems'];
      counterAxisAlignItems: FrameNode['counterAxisAlignItems'];
      itemSpacing: number;
      paddingTop: number;
      paddingRight: number;
      paddingBottom: number;
      paddingLeft: number;
      width: number;
      height: number;
    };

  const visibleChildren = container.children.filter((child) => child.visible);
  const axis = detectStackAxis(visibleChildren);
  if (!axis) {
    return {
      ok: false,
      message:
        'Auto Layout fix skipped: child alignment is unclear. Use Focus and apply it manually.'
    };
  }

  const sorted = [...visibleChildren].sort((a, b) =>
    axis === 'VERTICAL' ? a.y - b.y || a.x - b.x : a.x - b.x || a.y - b.y
  );
  const gaps: number[] = [];
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const current = sorted[index];
    const next = sorted[index + 1];
    if (!current || !next) {
      continue;
    }
    const currentEnd =
      axis === 'VERTICAL' ? current.y + current.height : current.x + current.width;
    const nextStart = axis === 'VERTICAL' ? next.y : next.x;
    const gap = nextStart - currentEnd;
    if (gap < -0.5) {
      return {
        ok: false,
        message:
          'Auto Layout fix skipped: overlapping children detected. Use manual layout cleanup first.'
      };
    }
    gaps.push(Math.max(0, gap));
  }

  const minX = Math.min(...visibleChildren.map((child) => child.x));
  const minY = Math.min(...visibleChildren.map((child) => child.y));
  const maxRight = Math.max(...visibleChildren.map((child) => child.x + child.width));
  const maxBottom = Math.max(...visibleChildren.map((child) => child.y + child.height));

  container.layoutMode = axis;
  container.primaryAxisAlignItems = 'MIN';
  container.counterAxisAlignItems = detectCounterAxisAlignment(container, visibleChildren, axis);
  container.itemSpacing = Math.max(0, Math.round(median(gaps)));
  container.paddingLeft = Math.max(0, Math.round(minX));
  container.paddingTop = Math.max(0, Math.round(minY));
  container.paddingRight = Math.max(0, Math.round(container.width - maxRight));
  container.paddingBottom = Math.max(0, Math.round(container.height - maxBottom));

  return {
    ok: true,
    message: 'Auto Layout applied with inferred spacing and padding.'
  };
}

function applyAbsolutePositioningFix(node: SceneNode): { ok: boolean; message: string } {
  if (!('layoutPositioning' in node)) {
    return {
      ok: false,
      message: 'Absolute positioning fix skipped: node does not support layout positioning.'
    };
  }

  const parent = node.parent;
  if (!parent || parent.type === 'PAGE' || parent.type === 'DOCUMENT' || parent.type === 'SLICE') {
    return {
      ok: false,
      message: 'Absolute positioning fix skipped: node is not inside an Auto Layout container.'
    };
  }

  if (!('layoutMode' in parent) || parent.layoutMode === 'NONE') {
    return {
      ok: false,
      message: 'Absolute positioning fix skipped: parent is not Auto Layout.'
    };
  }

  if (node.layoutPositioning !== 'ABSOLUTE') {
    return {
      ok: true,
      message: 'Node is already in Auto Layout flow.'
    };
  }

  node.layoutPositioning = 'AUTO';
  return {
    ok: true,
    message: 'Absolute positioning removed. Node now follows Auto Layout flow.'
  };
}

async function tryFixIssue(message: {
  nodeId: string;
  nodeName: string;
  category: string;
  reason: string;
  suggestion: string;
}): Promise<void> {
  const baseNode = await figma.getNodeByIdAsync(message.nodeId);
  if (!isSceneNode(baseNode)) {
    figma.notify('Fix failed: target node not found.');
    return;
  }

  let result: { ok: boolean; message: string } = {
    ok: false,
    message: 'This issue type is not auto-fixable yet. Use Focus for manual correction.'
  };

  const reasonText = `${message.reason} ${message.suggestion}`.toLowerCase();
  if (message.category === 'Layout Semantics') {
    if (reasonText.includes('absolute positioning')) {
      result = applyAbsolutePositioningFix(baseNode);
    } else if (reasonText.includes('auto layout')) {
      result = applyAutoLayoutFix(baseNode);
    }
  }

  figma.currentPage.selection = [baseNode];
  figma.viewport.scrollAndZoomIntoView([baseNode]);
  figma.notify(result.message);

  if (result.ok) {
    postToUI({
      type: 'ISSUE_FIX_RESULT',
      nodeId: message.nodeId,
      category: message.category,
      reason: message.reason,
      status: 'fixed',
      detail: result.message
    });
    invalidateCache();
    void computeAndPostAnalysis();
  }
}

async function getOrCreateDesignAgentCategoryId(): Promise<string | undefined> {
  if (!figma.annotations) {
    return undefined;
  }

  if (annotationCategoryId) {
    return annotationCategoryId;
  }

  const categories = await figma.annotations.getAnnotationCategoriesAsync();
  const existing = categories.find(
    (category) => category.label.toLowerCase() === 'designagent'
  );
  if (existing) {
    annotationCategoryId = existing.id;
    return annotationCategoryId;
  }

  const created = await figma.annotations.addAnnotationCategoryAsync({
    label: 'DesignAgent',
    color: 'orange'
  });
  annotationCategoryId = created.id;
  return annotationCategoryId;
}

async function createAnnotationForNode(message: {
  nodeId: string;
  nodeName: string;
  category: string;
  reason: string;
  suggestion: string;
}): Promise<void> {
  try {
    if (!figma.annotations) {
      figma.notify('Annotations are not available in this file/context.');
      return;
    }

    const baseNode = await figma.getNodeByIdAsync(message.nodeId);
    if (!isSceneNode(baseNode)) {
      figma.notify('Could not add annotation: target node not found.');
      return;
    }
    if (!hasAnnotationsMixin(baseNode)) {
      figma.notify('Could not add annotation: this node does not support annotations.');
      return;
    }

    const categoryId = await getOrCreateDesignAgentCategoryId();
    const nextAnnotation: Annotation = {
      label: buildAnnotationText(message),
      ...(categoryId ? { categoryId } : {})
    };

    baseNode.annotations = [...baseNode.annotations, nextAnnotation];
    figma.currentPage.selection = [baseNode];
    figma.viewport.scrollAndZoomIntoView([baseNode]);
    figma.notify('Annotation added.');
  } catch (error) {
    const messageText =
      error instanceof Error ? error.message : 'Unknown error creating annotation.';
    figma.notify(`Could not add annotation: ${messageText}`);
    postToUI({ type: 'ERROR', message: `Could not add annotation: ${messageText}` });
  }
}

function resolvePrimaryNode(selection: readonly SceneNode[]): SceneNode | null {
  if (selection.length > 0 && selection[0]) {
    return selection[0];
  }
  // Dev Mode: fall back to focusedNode when nothing is explicitly selected.
  const focused = (figma.currentPage as { focusedNode?: SceneNode | null }).focusedNode;
  if (focused && 'visible' in focused) {
    return focused;
  }
  return null;
}

async function computeAndPostAnalysis(): Promise<void> {
  const token = ++activeAnalysisToken;
  try {
    const selection = figma.currentPage.selection;
    const primaryNode = resolvePrimaryNode(selection);

    if (!primaryNode) {
      postToUI({ type: 'ANALYSIS_RESULT', payload: toEmptyAnalysis(activePreset, activeMode) });
      return;
    }

    if (isEmptyFrameSelection(primaryNode)) {
      postToUI({
        type: 'ANALYSIS_RESULT',
        payload: toEmptyAnalysis(
          activePreset,
          activeMode,
          `\"${primaryNode.name}\" is an empty frame. There is nothing to build yet.`
        )
      });
      return;
    }

    const flowCapable = detectFlowCapable(selection.length > 0 ? selection : [primaryNode]);
    const selectionSignature =
      selection.length > 0 ? getSelectionSignature(selection) : `focused:${primaryNode.id}`;

    const reusableCache =
      cache &&
      cache.selectionSignature === selectionSignature &&
      cache.primaryNodeId === primaryNode.id &&
      cache.linkBase === fallbackLinkBase
        ? cache
        : null;

    if (!reusableCache) {
      postToUI({
        type: 'ANALYSIS_STARTED',
        nodeId: primaryNode.id,
        nodeName: primaryNode.name,
        nodeType: primaryNode.type
      });
    }

    const core = reusableCache
      ? reusableCache.core
      : await analyzeNodeCoreAsync(primaryNode, {
          linkBase: fallbackLinkBase
        });

    if (token !== activeAnalysisToken) {
      // A newer analysis run started; discard this stale result.
      return;
    }

    if (!reusableCache) {
      cache = {
        selectionSignature,
        primaryNodeId: primaryNode.id,
        linkBase: fallbackLinkBase,
        core
      };
    }

    const analysis = composeAnalysisPayload(core, activePreset, activeMode, flowCapable);
    postToUI({ type: 'ANALYSIS_RESULT', payload: analysis });
  } catch (error) {
    if (token !== activeAnalysisToken) {
      return;
    }
    const message = error instanceof Error ? error.message : 'Unknown plugin error';
    postToUI({ type: 'ERROR', message });
  }
}

const MAX_DESIGN_MD_FRAMES = 12;

const DESIGN_MD_EXPORTABLE_TYPES = new Set([
  'FRAME',
  'SECTION',
  'COMPONENT',
  'COMPONENT_SET',
  'INSTANCE',
  'GROUP'
]);

function selectExportableNodes(selection: readonly SceneNode[]): SceneNode[] {
  const matching = selection.filter((node) => DESIGN_MD_EXPORTABLE_TYPES.has(node.type));
  if (matching.length > 0) {
    return matching;
  }
  const primary = resolvePrimaryNode(selection);
  return primary ? [primary] : [];
}

async function collectDesignMd(): Promise<{ markdown: string; frameCount: number }> {
  const selection = figma.currentPage.selection;
  const nodes = selectExportableNodes(selection);
  if (nodes.length === 0) {
    throw new Error('Select at least one frame, section, or component first.');
  }

  const limited = nodes.slice(0, MAX_DESIGN_MD_FRAMES);
  const omittedFrameCount = nodes.length - limited.length;
  const categories = await loadAnnotationCategories();

  const frames: DesignDocFrame[] = [];
  for (const node of limited) {
    const reusable =
      cache && cache.primaryNodeId === node.id && cache.linkBase === fallbackLinkBase
        ? cache.core
        : null;
    const core =
      reusable ??
      (await analyzeNodeCoreAsync(node, {
        linkBase: fallbackLinkBase,
        includeAssets: false,
        annotationCategories: categories
      }));
    frames.push({ core, preset: activePreset });
  }

  const markdown = generateDesignDoc(frames, {
    fileName: figma.root.name || 'Untitled',
    preset: activePreset,
    omittedFrameCount
  });

  return { markdown, frameCount: limited.length };
}

async function exportDesignMd(): Promise<void> {
  try {
    const { markdown, frameCount } = await collectDesignMd();
    postToUI({ type: 'DESIGN_MD_RESULT', markdown, filename: 'DESIGN.md', frameCount });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to export DESIGN.md';
    postToUI({ type: 'ERROR', message });
  }
}

// ---- Claude Code bridge: execute DesignAgent actions requested over the MCP/WS bridge ----

async function analyzePrimaryForBridge(): Promise<AnalysisCore> {
  const primary = resolvePrimaryNode(figma.currentPage.selection);
  if (!primary) {
    throw new Error('Nothing selected in Figma. Select a frame, component, or section first.');
  }
  if (cache && cache.primaryNodeId === primary.id && cache.linkBase === fallbackLinkBase) {
    return cache.core;
  }
  return analyzeNodeCoreAsync(primary, { linkBase: fallbackLinkBase, includeAssets: false });
}

function toNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseHexColor(input: unknown): { color: RGB; opacity: number } {
  const raw = String(input ?? '').trim().replace(/^#/, '');
  const hex = /^[0-9a-fA-F]{3}$/.test(raw)
    ? raw.split('').map((c) => c + c).join('')
    : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(hex) && !/^[0-9a-fA-F]{8}$/.test(hex)) {
    throw new Error(`Invalid color "${String(input)}". Use a hex value like #3366ff.`);
  }
  return {
    color: {
      r: parseInt(hex.slice(0, 2), 16) / 255,
      g: parseInt(hex.slice(2, 4), 16) / 255,
      b: parseInt(hex.slice(4, 6), 16) / 255
    },
    opacity: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
  };
}

function solidPaint(input: unknown): SolidPaint {
  const { color, opacity } = parseHexColor(input);
  return { type: 'SOLID', color, opacity };
}

function applyStroke(node: SceneNode, params: Record<string, unknown>): void {
  if (params.stroke == null || !('strokes' in node)) {
    return;
  }
  (node as GeometryMixin).strokes = [solidPaint(params.stroke)];
  if (params.strokeWeight != null) {
    (node as MinimalStrokesMixin).strokeWeight = toNumber(params.strokeWeight, 1);
  }
  const align = String(params.strokeAlign ?? '');
  if (align === 'INSIDE' || align === 'OUTSIDE' || align === 'CENTER') {
    (node as MinimalStrokesMixin).strokeAlign = align;
  }
}

function buildDropShadow(params: Record<string, unknown>): DropShadowEffect {
  const { color, opacity } = parseHexColor(params.color ?? '#00000040');
  return {
    type: 'DROP_SHADOW',
    color: {
      r: color.r,
      g: color.g,
      b: color.b,
      a: params.opacity != null ? toNumber(params.opacity, opacity) : opacity
    },
    offset: { x: toNumber(params.offsetX, 0), y: toNumber(params.offsetY, 4) },
    radius: toNumber(params.blur, 8),
    spread: toNumber(params.spread, 0),
    visible: true,
    blendMode: 'NORMAL'
  };
}

async function resolveParentContainer(parentId: unknown): Promise<BaseNode & ChildrenMixin> {
  if (parentId) {
    const parent = await figma.getNodeByIdAsync(String(parentId));
    if (parent && 'appendChild' in parent) {
      return parent as BaseNode & ChildrenMixin;
    }
    throw new Error(`Parent node ${String(parentId)} not found or cannot contain children.`);
  }
  return figma.currentPage;
}

async function loadFontForNewText(node: TextNode): Promise<void> {
  const fontName = node.fontName;
  if (fontName !== figma.mixed) {
    try {
      await figma.loadFontAsync(fontName);
      return;
    } catch {
      // fall through to a fallback font below
    }
  }
  const fonts = await figma.listAvailableFontsAsync();
  const fallback = fonts[0]?.fontName ?? { family: 'Inter', style: 'Regular' };
  await figma.loadFontAsync(fallback);
  node.fontName = fallback;
}

async function loadFontForExistingText(node: TextNode): Promise<void> {
  const current =
    node.fontName === figma.mixed && node.characters.length > 0
      ? node.getRangeFontName(0, 1)
      : node.fontName;
  const fontName = current === figma.mixed ? { family: 'Inter', style: 'Regular' } : current;
  try {
    await figma.loadFontAsync(fontName);
    node.fontName = fontName;
  } catch {
    const fonts = await figma.listAvailableFontsAsync();
    const fallback = fonts[0]?.fontName ?? { family: 'Inter', style: 'Regular' };
    await figma.loadFontAsync(fallback);
    node.fontName = fallback;
  }
}

const WEIGHT_ALIASES: Record<string, string[]> = {
  '100': ['Thin', 'Hairline'],
  '200': ['ExtraLight', 'Extra Light', 'UltraLight'],
  '300': ['Light'],
  '400': ['Regular', 'Normal', 'Book'],
  '500': ['Medium'],
  '600': ['SemiBold', 'Semi Bold', 'DemiBold', 'Demi Bold'],
  '700': ['Bold'],
  '800': ['ExtraBold', 'Extra Bold', 'UltraBold'],
  '900': ['Black', 'Heavy']
};

// Apply a font weight to a text node. Weights are family-specific style names in
// Figma, so resolve the requested weight (a number like 600 or a style name like
// "Semi Bold") against the styles the node's font family actually ships.
async function applyTextWeight(node: TextNode, weight: unknown): Promise<void> {
  const base =
    node.fontName === figma.mixed
      ? node.characters.length > 0
        ? node.getRangeFontName(0, 1)
        : { family: 'Inter', style: 'Regular' }
      : node.fontName;
  const family = base === figma.mixed ? 'Inter' : base.family;

  const raw = String(weight).trim();
  const candidates = /^\d+$/.test(raw)
    ? WEIGHT_ALIASES[raw] ?? ['Regular']
    : [raw, ...(WEIGHT_ALIASES[raw] ?? [])];

  const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, '');
  const fonts = await figma.listAvailableFontsAsync();
  const familyStyles = fonts
    .filter((f) => f.fontName.family === family)
    .map((f) => f.fontName.style);

  let match: string | undefined;
  for (const candidate of candidates) {
    match = familyStyles.find((style) => norm(style) === norm(candidate));
    if (match) {
      break;
    }
  }
  if (!match) {
    throw new Error(
      `Font "${family}" has no "${raw}" weight. Available: ${familyStyles.join(', ') || 'none'}.`
    );
  }

  const fontName = { family, style: match };
  await figma.loadFontAsync(fontName);
  node.fontName = fontName;
}

function normalizeTextAlign(
  value: unknown
): 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED' | null {
  const v = String(value ?? '').toUpperCase();
  return v === 'LEFT' || v === 'CENTER' || v === 'RIGHT' || v === 'JUSTIFIED' ? v : null;
}

function normalizeTextVAlign(value: unknown): 'TOP' | 'CENTER' | 'BOTTOM' | null {
  const v = String(value ?? '').toUpperCase();
  return v === 'TOP' || v === 'CENTER' || v === 'BOTTOM' ? v : null;
}

function selectAndReturn(node: SceneNode): { id: string; name: string; type: string } {
  figma.currentPage.selection = [node];
  figma.viewport.scrollAndZoomIntoView([node]);
  return { id: node.id, name: node.name, type: node.type };
}

async function runBridgeCommand(
  command: string,
  params: Record<string, unknown>
): Promise<unknown> {
  switch (command) {
    case 'status': {
      const selection = figma.currentPage.selection;
      const primary = selection[0];
      return {
        connected: true,
        fileName: figma.root.name || 'Untitled',
        page: figma.currentPage.name,
        selectionCount: selection.length,
        primary: primary ? { id: primary.id, name: primary.name, type: primary.type } : null,
        preset: activePreset
      };
    }
    case 'get_design_md':
      return collectDesignMd();
    case 'get_spec': {
      const core = await analyzePrimaryForBridge();
      return { selectedNode: core.selectedNode, intent: core.intent, uiSpec: core.uiSpec };
    }
    case 'get_score': {
      const core = await analyzePrimaryForBridge();
      const percent =
        core.score.applicableMax > 0
          ? Math.round((core.score.total / core.score.applicableMax) * 100)
          : 0;
      return {
        node: core.selectedNode,
        score: core.score,
        readiness: { total: core.score.total, max: core.score.applicableMax, percent }
      };
    }
    case 'list_issues': {
      const core = await analyzePrimaryForBridge();
      return { node: core.selectedNode, issues: core.checklist };
    }
    case 'focus': {
      const nodeId = String(params.nodeId ?? '');
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!isSceneNode(node)) {
        throw new Error(`Node not found: ${nodeId}`);
      }
      figma.currentPage.selection = [node];
      figma.viewport.scrollAndZoomIntoView([node]);
      return { focused: { id: node.id, name: node.name } };
    }
    case 'select': {
      const ids = Array.isArray(params.nodeIds)
        ? params.nodeIds.map(String)
        : params.nodeId
        ? [String(params.nodeId)]
        : [];
      const nodes: SceneNode[] = [];
      for (const id of ids) {
        const node = await figma.getNodeByIdAsync(id);
        if (isSceneNode(node)) {
          nodes.push(node);
        }
      }
      if (nodes.length === 0) {
        throw new Error('No valid nodes to select.');
      }
      figma.currentPage.selection = nodes;
      figma.viewport.scrollAndZoomIntoView(nodes);
      return { selected: nodes.map((node) => ({ id: node.id, name: node.name })) };
    }
    case 'annotate': {
      const nodeId = String(params.nodeId ?? '');
      const label = String(params.label ?? params.reason ?? '');
      if (!nodeId || !label) {
        throw new Error('annotate requires "nodeId" and "label".');
      }
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!isSceneNode(node)) {
        throw new Error(`Node not found: ${nodeId}`);
      }
      await createAnnotationForNode({
        nodeId,
        nodeName: node.name,
        category: 'DesignAgent',
        reason: label,
        suggestion: String(params.suggestion ?? '')
      });
      return { annotated: { id: node.id, name: node.name }, label };
    }
    case 'apply_fix': {
      const nodeId = String(params.nodeId ?? '');
      const fix = String(params.fix ?? '');
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!isSceneNode(node)) {
        throw new Error(`Node not found: ${nodeId}`);
      }
      let result: { ok: boolean; message: string };
      if (fix === 'auto-layout') {
        result = applyAutoLayoutFix(node);
      } else if (fix === 'absolute-positioning') {
        result = applyAbsolutePositioningFix(node);
      } else {
        throw new Error(`Unknown fix "${fix}". Use "auto-layout" or "absolute-positioning".`);
      }
      if (result.ok) {
        figma.currentPage.selection = [node];
        figma.viewport.scrollAndZoomIntoView([node]);
        invalidateCache();
        void computeAndPostAnalysis();
      }
      return { ok: result.ok, message: result.message };
    }
    case 'create_frame': {
      const parent = await resolveParentContainer(params.parentId);
      const frame = figma.createFrame();
      if (params.name) {
        frame.name = String(params.name);
      }
      frame.resize(toNumber(params.width, 100), toNumber(params.height, 100));
      const layoutMode = String(params.layoutMode ?? '');
      if (layoutMode === 'HORIZONTAL' || layoutMode === 'VERTICAL') {
        frame.layoutMode = layoutMode;
        if (params.itemSpacing != null) {
          frame.itemSpacing = toNumber(params.itemSpacing, 0);
        }
        if (params.padding != null) {
          const pad = toNumber(params.padding, 0);
          frame.paddingTop = pad;
          frame.paddingRight = pad;
          frame.paddingBottom = pad;
          frame.paddingLeft = pad;
        }
      }
      if (params.fill != null) {
        frame.fills = [solidPaint(params.fill)];
      }
      if (params.cornerRadius != null) {
        frame.cornerRadius = toNumber(params.cornerRadius, 0);
      }
      applyStroke(frame, params);
      parent.appendChild(frame);
      if (parent.type === 'PAGE') {
        frame.x = toNumber(params.x, 0);
        frame.y = toNumber(params.y, 0);
      }
      return selectAndReturn(frame);
    }
    case 'create_rectangle':
    case 'create_ellipse': {
      const parent = await resolveParentContainer(params.parentId);
      const node = command === 'create_ellipse' ? figma.createEllipse() : figma.createRectangle();
      if (params.name) {
        node.name = String(params.name);
      }
      node.resize(toNumber(params.width, 100), toNumber(params.height, 100));
      if (params.fill != null) {
        node.fills = [solidPaint(params.fill)];
      }
      if (command === 'create_rectangle' && params.cornerRadius != null) {
        (node as RectangleNode).cornerRadius = toNumber(params.cornerRadius, 0);
      }
      applyStroke(node, params);
      parent.appendChild(node);
      if (parent.type === 'PAGE') {
        node.x = toNumber(params.x, 0);
        node.y = toNumber(params.y, 0);
      }
      return selectAndReturn(node);
    }
    case 'create_text': {
      const parent = await resolveParentContainer(params.parentId);
      const text = figma.createText();
      parent.appendChild(text);
      await loadFontForNewText(text);
      text.characters = String(params.characters ?? '');
      if (params.weight != null) {
        try {
          await applyTextWeight(text, params.weight);
        } catch {
          // keep the default font if the requested weight isn't available
        }
      }
      if (params.fontSize != null) {
        text.fontSize = toNumber(params.fontSize, 16);
      }
      if (params.color != null) {
        text.fills = [solidPaint(params.color)];
      }
      const createAlign = normalizeTextAlign(params.align);
      if (createAlign) {
        text.textAlignHorizontal = createAlign;
      }
      if (params.name) {
        text.name = String(params.name);
      }
      if (parent.type === 'PAGE') {
        text.x = toNumber(params.x, 0);
        text.y = toNumber(params.y, 0);
      }
      return selectAndReturn(text);
    }
    case 'set_text': {
      const node = await figma.getNodeByIdAsync(String(params.nodeId ?? ''));
      if (!node || node.type !== 'TEXT') {
        throw new Error('set_text requires the id of a text node.');
      }
      await loadFontForExistingText(node);
      node.characters = String(params.characters ?? '');
      return { id: node.id, name: node.name };
    }
    case 'set_fill': {
      const node = await figma.getNodeByIdAsync(String(params.nodeId ?? ''));
      if (!isSceneNode(node) || !('fills' in node)) {
        throw new Error('set_fill requires a node that supports fills.');
      }
      (node as GeometryMixin).fills = [solidPaint(params.color)];
      return { id: node.id, name: node.name };
    }
    case 'set_corner_radius': {
      const node = await figma.getNodeByIdAsync(String(params.nodeId ?? ''));
      if (!isSceneNode(node) || !('cornerRadius' in node)) {
        throw new Error('set_corner_radius requires a node with corners (frame, rectangle, component).');
      }
      const corner = node as SceneNode & {
        cornerRadius: number | symbol;
        topLeftRadius?: number;
        topRightRadius?: number;
        bottomLeftRadius?: number;
        bottomRightRadius?: number;
      };
      const perCorner =
        params.topLeft != null ||
        params.topRight != null ||
        params.bottomLeft != null ||
        params.bottomRight != null;
      if (perCorner) {
        if (!('topLeftRadius' in corner)) {
          throw new Error('This node does not support per-corner radius.');
        }
        if (params.topLeft != null) corner.topLeftRadius = toNumber(params.topLeft, 0);
        if (params.topRight != null) corner.topRightRadius = toNumber(params.topRight, 0);
        if (params.bottomLeft != null) corner.bottomLeftRadius = toNumber(params.bottomLeft, 0);
        if (params.bottomRight != null) corner.bottomRightRadius = toNumber(params.bottomRight, 0);
      } else {
        corner.cornerRadius = toNumber(params.radius, 0);
      }
      return { id: node.id, name: node.name };
    }
    case 'set_stroke': {
      const node = await figma.getNodeByIdAsync(String(params.nodeId ?? ''));
      if (!isSceneNode(node) || !('strokes' in node)) {
        throw new Error('set_stroke requires a node that supports strokes.');
      }
      applyStroke(node, {
        stroke: params.color,
        strokeWeight: params.weight,
        strokeAlign: params.align
      });
      return { id: node.id, name: node.name };
    }
    case 'set_shadow': {
      const node = await figma.getNodeByIdAsync(String(params.nodeId ?? ''));
      if (!isSceneNode(node) || !('effects' in node)) {
        throw new Error('set_shadow requires a node that supports effects.');
      }
      (node as BlendMixin).effects = [buildDropShadow(params)];
      return { id: node.id, name: node.name };
    }
    case 'set_text_style': {
      const node = await figma.getNodeByIdAsync(String(params.nodeId ?? ''));
      if (!node || node.type !== 'TEXT') {
        throw new Error('set_text_style requires the id of a text node.');
      }
      if (params.weight != null) {
        await applyTextWeight(node, params.weight);
      } else if (params.fontSize != null) {
        await loadFontForExistingText(node);
      }
      if (params.fontSize != null) {
        node.fontSize = toNumber(params.fontSize, 16);
      }
      if (params.color != null) {
        node.fills = [solidPaint(params.color)];
      }
      const alignH = normalizeTextAlign(params.align);
      if (alignH) {
        node.textAlignHorizontal = alignH;
      }
      const alignV = normalizeTextVAlign(params.valign);
      if (alignV) {
        node.textAlignVertical = alignV;
      }
      return { id: node.id, name: node.name };
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

async function handleBridgeCommand(
  id: string,
  command: string,
  params: Record<string, unknown>
): Promise<void> {
  try {
    const result = await runBridgeCommand(command, params);
    postToUI({ type: 'BRIDGE_RESULT', id, ok: true, result });
  } catch (error) {
    postToUI({
      type: 'BRIDGE_RESULT',
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

figma.showUI(__html__, {
  width: PANEL_SIZE.width,
  height: PANEL_SIZE.height,
  themeColors: true
});

figma.on('selectionchange', () => {
  invalidateCache();
  void computeAndPostAnalysis();
});

figma.on('currentpagechange', () => {
  invalidateCache();
  void computeAndPostAnalysis();
});

// Dev Mode: poll currentPage.focusedNode so analysis follows the developer's
// inspect focus even when no explicit selection is made. There is no dedicated
// "focusednodechange" event yet, so a low-frequency poll is the supported path.
const FOCUSED_POLL_MS = 750;
function tickFocusedNode(): void {
  try {
    if (figma.editorType !== 'dev') {
      return;
    }
    const focused = (figma.currentPage as { focusedNode?: SceneNode | null }).focusedNode;
    const focusedId = focused?.id;
    if (focusedId === lastFocusedNodeId) {
      return;
    }
    lastFocusedNodeId = focusedId;
    if (focusedId && figma.currentPage.selection.length === 0) {
      invalidateCache();
      void computeAndPostAnalysis();
    }
  } catch {
    // ignore
  }
}
setInterval(tickFocusedNode, FOCUSED_POLL_MS);

figma.ui.onmessage = (message: ToPluginMessage) => {
  if (message.type === 'SET_PRESET') {
    if (message.preset in PRESET_DEFINITIONS) {
      activePreset = message.preset;
      void computeAndPostAnalysis();
    }
    return;
  }

  if (message.type === 'SET_MODE') {
    activeMode = message.mode;
    void computeAndPostAnalysis();
    return;
  }

  if (message.type === 'SET_FIGMA_LINK_BASE') {
    const parsed = parseFigmaLinkBase(message.link);
    if (parsed !== fallbackLinkBase) {
      fallbackLinkBase = parsed;
      invalidateCache();
    }
    void computeAndPostAnalysis();
    return;
  }

  if (message.type === 'FOCUS_NODE') {
    void figma.getNodeByIdAsync(message.nodeId).then((node) => {
      if (!node || !('type' in node)) {
        return;
      }

      if (
        node.type === 'PAGE' ||
        node.type === 'DOCUMENT'
      ) {
        return;
      }

      if (!('visible' in node)) {
        return;
      }

      const sceneNode = node as SceneNode;
      figma.currentPage.selection = [sceneNode];
      figma.viewport.scrollAndZoomIntoView([sceneNode]);
    });
    return;
  }

  if (message.type === 'ADD_ANNOTATION') {
    void createAnnotationForNode(message);
    return;
  }

  if (message.type === 'EXPORT_DESIGN_MD') {
    void exportDesignMd();
    return;
  }

  if (message.type === 'BRIDGE_COMMAND') {
    void handleBridgeCommand(message.id, message.command, message.params);
    return;
  }

  if (message.type === 'REFRESH_REQUEST') {
    invalidateCache();
    void computeAndPostAnalysis();
  }
};

void computeAndPostAnalysis();
