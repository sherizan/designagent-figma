import {
  analyzeNodeCoreAsync,
  composeAnalysisPayload,
  type AnalysisCore
} from './core/analyze';
import { generateDesignDoc, type DesignDocFrame } from './core/designdoc';
import { parseDesignMd } from './core/parsedesignmd';
import { generateHtml, type HtmlNode } from './core/htmldoc';
import { loadAnnotationCategories } from './core/extract';
import type { DesignTreeNode } from './shared/designtree';
import { isScreenLikeNode } from './core/intent';
import type { EmptyAnalysis, Mode } from './core/types';
import type { ToPluginMessage, ToUIMessage } from './shared/messages';

const DEFAULT_MODE: Mode = 'system-first';
const PANEL_SIZE = {
  width: 400,
  height: 720
};

// ---- Console capture (backs the console_logs bridge tool) ----
// Override console.* into a ring buffer so the bridge can return the plugin's
// own logs for debugging. The UI iframe forwards its logs here too (UI_CONSOLE_LOG).
interface LogEntry {
  ts: number;
  level: string;
  source: 'sandbox' | 'ui';
  text: string;
}
const LOG_BUFFER_MAX = 1000;
const logBuffer: LogEntry[] = [];

function pushLog(level: string, source: 'sandbox' | 'ui', text: string): void {
  logBuffer.push({ ts: Date.now(), level, source, text });
  if (logBuffer.length > LOG_BUFFER_MAX) {
    logBuffer.splice(0, logBuffer.length - LOG_BUFFER_MAX);
  }
}

function formatLogArg(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

(function captureConsole(): void {
  const c = console as unknown as Record<string, ((...a: unknown[]) => void) | undefined>;
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    const original = c[level]?.bind(console);
    c[level] = (...args: unknown[]) => {
      try {
        pushLog(level, 'sandbox', args.map(formatLogArg).join(' '));
      } catch {
        // never let logging break the plugin
      }
      if (original) original(...args);
    };
  }
})();

interface AnalysisCache {
  selectionSignature: string;
  primaryNodeId: string;
  linkBase?: string;
  core: AnalysisCore;
}

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

function toEmptyAnalysis(mode: Mode, message?: string): EmptyAnalysis {
  return {
    hasSelection: false,
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
      postToUI({ type: 'ANALYSIS_RESULT', payload: toEmptyAnalysis(activeMode) });
      return;
    }

    if (isEmptyFrameSelection(primaryNode)) {
      postToUI({
        type: 'ANALYSIS_RESULT',
        payload: toEmptyAnalysis(
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

    const analysis = composeAnalysisPayload(core, activeMode, flowCapable);
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
        annotationCategories: categories
      }));
    frames.push({ core });
  }

  const markdown = generateDesignDoc(frames, {
    fileName: figma.root.name || 'Untitled',
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

// ---- DESIGN.md → Figma (apply tokens) ----

// Resolve a requested family + weight to an installed font style, loading it.
// Falls back to Inter Regular when the family/weight isn't available.
async function resolveAndLoadFont(family: string, weight?: number): Promise<FontName> {
  const fonts = await figma.listAvailableFontsAsync();
  const styles = fonts.filter((f) => f.fontName.family === family).map((f) => f.fontName.style);
  if (styles.length > 0) {
    const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, '');
    const candidates = weight ? WEIGHT_ALIASES[String(weight)] ?? ['Regular'] : ['Regular'];
    const style =
      styles.find((s) => candidates.some((c) => norm(c) === norm(s))) ??
      (styles.includes('Regular') ? 'Regular' : styles[0]);
    if (style) {
      const fontName = { family, style };
      try {
        await figma.loadFontAsync(fontName);
        return fontName;
      } catch {
        // fall through to Inter
      }
    }
  }
  const fallback = { family: 'Inter', style: 'Regular' };
  await figma.loadFontAsync(fallback);
  return fallback;
}

// Apply a DESIGN.md's token frontmatter into the current Figma file: colors and
// spacing/radius become variables in a "DESIGN.md" collection; typography becomes
// text styles. Existing variables/styles of the same name are updated in place.
async function applyDesignMdToFigma(content: string): Promise<void> {
  try {
    const parsed = parseDesignMd(content);
    let colors = 0;
    let numbers = 0;
    let textStyles = 0;

    const hasVars =
      Object.keys(parsed.colors).length +
        Object.keys(parsed.spacing).length +
        Object.keys(parsed.rounded).length >
      0;

    if (hasVars) {
      const collections = await figma.variables.getLocalVariableCollectionsAsync();
      const collection =
        collections.find((c) => c.name === 'DESIGN.md') ??
        figma.variables.createVariableCollection('DESIGN.md');
      const mode = collection.modes[0];
      if (!mode) {
        throw new Error('Variable collection has no mode.');
      }
      const modeId = mode.modeId;

      const existing = new Map<string, Variable>();
      for (const id of collection.variableIds) {
        const v = await figma.variables.getVariableByIdAsync(id);
        if (v) existing.set(v.name, v);
      }
      const upsert = (
        name: string,
        type: 'COLOR' | 'FLOAT',
        value: RGBA | number
      ): void => {
        let variable = existing.get(name);
        if (!variable) {
          variable = figma.variables.createVariable(name, collection, type);
          existing.set(name, variable);
        }
        variable.setValueForMode(modeId, value);
      };

      for (const [name, raw] of Object.entries(parsed.colors)) {
        const parsedColor = parseCssColor(raw);
        if (!parsedColor) continue;
        upsert(`color/${name}`, 'COLOR', {
          r: parsedColor.color.r,
          g: parsedColor.color.g,
          b: parsedColor.color.b,
          a: parsedColor.opacity
        });
        colors += 1;
      }
      for (const [name, value] of Object.entries(parsed.spacing)) {
        upsert(`spacing/${name}`, 'FLOAT', value);
        numbers += 1;
      }
      for (const [name, value] of Object.entries(parsed.rounded)) {
        upsert(`radius/${name}`, 'FLOAT', value);
        numbers += 1;
      }
    }

    if (parsed.typography.length > 0) {
      const styles = await figma.getLocalTextStylesAsync();
      const byName = new Map(styles.map((s) => [s.name, s]));
      for (const token of parsed.typography) {
        const fontName = await resolveAndLoadFont(token.fontFamily ?? 'Inter', token.fontWeight);
        let style = byName.get(token.key);
        if (!style) {
          style = figma.createTextStyle();
          style.name = token.key;
          byName.set(token.key, style);
        }
        style.fontName = fontName;
        if (token.fontSize && token.fontSize > 0) {
          style.fontSize = token.fontSize;
        }
        if (token.lineHeight) {
          const lh = token.lineHeight.trim();
          const n = parseFloat(lh);
          if (Number.isFinite(n)) {
            style.lineHeight = lh.endsWith('px')
              ? { unit: 'PIXELS', value: n }
              : { unit: 'PERCENT', value: n * 100 };
          }
        }
        if (token.letterSpacing) {
          const ls = token.letterSpacing.trim();
          const n = parseFloat(ls);
          if (Number.isFinite(n) && ls.endsWith('px')) {
            style.letterSpacing = { unit: 'PIXELS', value: n };
          } else if (Number.isFinite(n) && ls.endsWith('%')) {
            style.letterSpacing = { unit: 'PERCENT', value: n };
          }
        }
        textStyles += 1;
      }
    }

    postToUI({
      type: 'APPLY_DESIGN_MD_RESULT',
      ok: true,
      result: { colors, numbers, textStyles }
    });
  } catch (error) {
    postToUI({
      type: 'APPLY_DESIGN_MD_RESULT',
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to apply DESIGN.md'
    });
  }
}

// ---- Design → HTML export ----

const HTML_VECTOR_TYPES = new Set([
  'VECTOR',
  'BOOLEAN_OPERATION',
  'STAR',
  'POLYGON',
  'LINE'
]);

async function fullNodeCss(node: SceneNode): Promise<Record<string, string>> {
  if (!('getCSSAsync' in node)) {
    return {};
  }
  try {
    const css = await node.getCSSAsync();
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(css)) {
      if (value) {
        out[key] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

async function exportNodeAsset(
  node: SceneNode,
  format: 'SVG' | 'PNG'
): Promise<{ mime: string; dataUrl: string } | null> {
  try {
    const bytes =
      format === 'SVG'
        ? await node.exportAsync({ format: 'SVG' })
        : await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 2 } });
    const mime = format === 'SVG' ? 'image/svg+xml' : 'image/png';
    return { mime, dataUrl: `data:${mime};base64,${figma.base64Encode(bytes)}` };
  } catch {
    return null;
  }
}

function nodeHasImageFill(node: SceneNode): boolean {
  if (!('fills' in node)) {
    return false;
  }
  const fills = (node as GeometryMixin).fills;
  return Array.isArray(fills) && fills.some((paint: Paint) => paint.type === 'IMAGE');
}

async function buildHtmlTree(node: SceneNode, budget: { assets: number }): Promise<HtmlNode> {
  const css = await fullNodeCss(node);

  if (node.type === 'TEXT') {
    return { tag: 'span', css, text: node.characters, children: [] };
  }

  const isVector = HTML_VECTOR_TYPES.has(node.type);
  const isImage = nodeHasImageFill(node);
  if ((isVector || isImage) && budget.assets > 0) {
    budget.assets -= 1;
    const asset = await exportNodeAsset(node, isVector ? 'SVG' : 'PNG');
    if (asset) {
      return { tag: 'img', css, asset, children: [] };
    }
  }

  const children: HtmlNode[] = [];
  if ('children' in node) {
    for (const child of node.children) {
      if (child.visible !== false) {
        children.push(await buildHtmlTree(child, budget));
      }
    }
  }
  return { tag: 'div', css, children };
}

async function exportHtml(): Promise<void> {
  try {
    const node = resolvePrimaryNode(figma.currentPage.selection);
    if (!node) {
      throw new Error('Select a frame, component, or section to export HTML.');
    }
    const tree = await buildHtmlTree(node, { assets: 24 });
    const html = generateHtml(tree, { title: node.name || 'Design' });
    postToUI({ type: 'HTML_RESULT', html, filename: `${node.name || 'design'}.html` });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to export HTML';
    postToUI({ type: 'ERROR', message });
  }
}

// ---- HTML → Design: build Figma nodes from a rendered HTML tree (from the UI) ----

async function buildDesignNode(
  node: DesignTreeNode,
  parent: BaseNode & ChildrenMixin
): Promise<SceneNode> {
  if (node.kind === 'text') {
    const text = figma.createText();
    parent.appendChild(text);
    await loadFontForNewText(text);
    text.characters = node.text ?? '';
    if (node.fontSize && node.fontSize > 0) {
      text.fontSize = node.fontSize;
    }
    if (node.fontWeight) {
      try {
        await applyTextWeight(text, node.fontWeight);
      } catch {
        // keep the default weight if the family lacks it
      }
    }
    const fill = cssSolidPaint(node.textColor);
    if (fill) {
      text.fills = [fill];
    }
    if (node.letterSpacing) {
      text.letterSpacing = { value: node.letterSpacing, unit: 'PIXELS' };
    }
    if (node.lineHeight && node.lineHeight > 0) {
      text.lineHeight = { value: node.lineHeight, unit: 'PIXELS' };
    }
    const align = normalizeTextAlign(node.textAlign);
    if (align) {
      text.textAlignHorizontal = align;
    }
    // Single-line text hugs its content (no re-wrapping in the fallback font);
    // wrapped text keeps its width and grows in height.
    if (node.multiline) {
      text.textAutoResize = 'HEIGHT';
      try {
        text.resize(Math.max(1, node.width), Math.max(1, node.height));
      } catch {
        // ignore
      }
    } else {
      text.textAutoResize = 'WIDTH_AND_HEIGHT';
    }
    text.x = node.x;
    text.y = node.y;
    return text;
  }

  if (node.kind === 'svg' && node.svg) {
    let svgNode: FrameNode;
    try {
      svgNode = figma.createNodeFromSvg(node.svg);
    } catch {
      const fallback = figma.createFrame();
      parent.appendChild(fallback);
      fallback.resize(Math.max(1, node.width), Math.max(1, node.height));
      fallback.fills = [];
      fallback.x = node.x;
      fallback.y = node.y;
      return fallback;
    }
    parent.appendChild(svgNode);
    try {
      svgNode.resize(Math.max(1, node.width), Math.max(1, node.height));
    } catch {
      // some svg nodes resist resize
    }
    svgNode.x = node.x;
    svgNode.y = node.y;
    return svgNode;
  }

  if (node.kind === 'image' && node.dataUrl) {
    const rect = figma.createRectangle();
    parent.appendChild(rect);
    rect.resize(Math.max(1, node.width), Math.max(1, node.height));
    rect.x = node.x;
    rect.y = node.y;
    try {
      const base64 = node.dataUrl.replace(/^data:[^;]+;base64,/, '');
      const image = figma.createImage(figma.base64Decode(base64));
      rect.fills = [{ type: 'IMAGE', scaleMode: 'FILL', imageHash: image.hash }];
    } catch {
      rect.fills = [];
    }
    return rect;
  }

  const frame = figma.createFrame();
  parent.appendChild(frame);
  frame.clipsContent = false;
  const fill = cssSolidPaint(node.fill);
  frame.fills = fill ? [fill] : [];
  const stroke = cssSolidPaint(node.stroke);
  if (stroke) {
    frame.strokes = [stroke];
    if (node.strokeWidth && node.strokeWidth > 0) {
      frame.strokeWeight = node.strokeWidth;
    }
  }
  if (node.cornerRadius && node.cornerRadius > 0) {
    frame.cornerRadius = node.cornerRadius;
  }
  if (typeof node.opacity === 'number' && node.opacity < 1) {
    frame.opacity = node.opacity;
  }
  if (node.shadow) {
    const shadowColor = parseCssColor(node.shadow.color);
    if (shadowColor) {
      frame.effects = [
        {
          type: 'DROP_SHADOW',
          color: {
            r: shadowColor.color.r,
            g: shadowColor.color.g,
            b: shadowColor.color.b,
            a: shadowColor.opacity
          },
          offset: { x: node.shadow.x, y: node.shadow.y },
          radius: node.shadow.blur,
          spread: node.shadow.spread,
          visible: true,
          blendMode: 'NORMAL'
        }
      ];
    }
  }

  // Auto Layout when the source element was flex/stack; absolute otherwise.
  if (node.layout) {
    frame.layoutMode = node.layout;
    frame.itemSpacing = node.itemSpacing ?? 0;
    frame.paddingTop = node.paddingTop ?? 0;
    frame.paddingRight = node.paddingRight ?? 0;
    frame.paddingBottom = node.paddingBottom ?? 0;
    frame.paddingLeft = node.paddingLeft ?? 0;
    frame.primaryAxisAlignItems = node.primaryAxisAlign ?? 'MIN';
    frame.counterAxisAlignItems = node.counterAxisAlign ?? 'MIN';
    frame.primaryAxisSizingMode = 'FIXED';
    frame.counterAxisSizingMode = 'FIXED';
  } else {
    frame.layoutMode = 'NONE';
  }
  frame.resize(Math.max(1, node.width), Math.max(1, node.height));
  frame.x = node.x;
  frame.y = node.y;

  for (const child of node.children) {
    const created = await buildDesignNode(child, frame);
    if (node.layout && child.absolute && 'layoutPositioning' in created) {
      // Margin-inset child: keep its measured x/y instead of flowing it.
      (created as SceneNode & { layoutPositioning: 'ABSOLUTE' }).layoutPositioning = 'ABSOLUTE';
      (created as SceneNode & LayoutMixin).x = child.x;
      (created as SceneNode & LayoutMixin).y = child.y;
    } else if (node.layout && child.stretch && 'layoutAlign' in created) {
      (created as SceneNode & { layoutAlign: 'STRETCH' }).layoutAlign = 'STRETCH';
    }
  }
  return frame;
}

// Tidy default placement: drop a new top-level node to the right of the
// rightmost existing node, aligned to the topmost — so generated frames line up
// in a row instead of stacking at the origin and overlapping prior work.
const CANVAS_GUTTER = 80;

function nextCanvasPosition(excludeId?: string): { x: number; y: number } {
  let maxRight = -Infinity;
  let minTop = Infinity;
  for (const child of figma.currentPage.children) {
    if (child.id === excludeId || !('x' in child) || !('width' in child)) continue;
    const node = child as SceneNode & LayoutMixin;
    maxRight = Math.max(maxRight, node.x + node.width);
    minTop = Math.min(minTop, node.y);
  }
  if (maxRight === -Infinity) return { x: 0, y: 0 };
  return { x: Math.round(maxRight + CANVAS_GUTTER), y: Math.round(minTop) };
}

// Honor an explicit x/y from the caller; otherwise auto-place tidily.
function placeOnPage(node: SceneNode & LayoutMixin, x: unknown, y: unknown): void {
  if (x == null && y == null) {
    const pos = nextCanvasPosition(node.id);
    node.x = pos.x;
    node.y = pos.y;
  } else {
    node.x = toNumber(x, 0);
    node.y = toNumber(y, 0);
  }
}

async function createDesignTree(message: {
  id: string;
  tree: DesignTreeNode;
  x?: number;
  y?: number;
  parentId?: string;
}): Promise<void> {
  try {
    const parent = await resolveParentContainer(message.parentId);
    const root = await buildDesignNode(message.tree, parent);
    if (parent.type === 'PAGE' && 'x' in root) {
      placeOnPage(root as SceneNode & LayoutMixin, message.x, message.y);
    }
    figma.currentPage.selection = [root];
    figma.viewport.scrollAndZoomIntoView([root]);
    postToUI({
      type: 'DESIGN_TREE_RESULT',
      id: message.id,
      ok: true,
      result: { id: root.id, name: root.name }
    });
  } catch (error) {
    postToUI({
      type: 'DESIGN_TREE_RESULT',
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
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
  return analyzeNodeCoreAsync(primary, { linkBase: fallbackLinkBase });
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

// Parse a CSS color string (rgb/rgba/hex) into a Figma RGB + opacity.
function parseCssColor(input: unknown): { color: RGB; opacity: number } | null {
  const value = String(input ?? '').trim();
  if (!value || value === 'transparent' || value === 'none') {
    return null;
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(value);
  if (rgb && rgb[1]) {
    const parts = rgb[1].split(',').map((p) => p.trim());
    const r = Number(parts[0]) / 255;
    const g = Number(parts[1]) / 255;
    const b = Number(parts[2]) / 255;
    const a = parts[3] != null ? Number(parts[3]) : 1;
    if ([r, g, b].some((n) => Number.isNaN(n))) {
      return null;
    }
    return { color: { r, g, b }, opacity: Number.isNaN(a) ? 1 : a };
  }
  if (value.startsWith('#')) {
    try {
      return parseHexColor(value);
    } catch {
      return null;
    }
  }
  return null;
}

function cssSolidPaint(input: unknown): SolidPaint | null {
  const parsed = parseCssColor(input);
  return parsed ? { type: 'SOLID', color: parsed.color, opacity: parsed.opacity } : null;
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

function normalizeScaleMode(value: unknown): 'FILL' | 'FIT' | 'CROP' | 'TILE' {
  const v = String(value ?? '').toUpperCase();
  return v === 'FIT' || v === 'CROP' || v === 'TILE' ? v : 'FILL';
}

// Decode base64 image bytes (sent by the MCP server, which did the network/file
// IO the plugin sandbox can't) and register them as a Figma image.
function imagePaintFromBase64(base64: unknown, scaleMode: unknown): { paint: ImagePaint; image: Image } {
  const data = String(base64 ?? '');
  if (!data) {
    throw new Error('No image data received.');
  }
  const image = figma.createImage(figma.base64Decode(data));
  return {
    image,
    paint: { type: 'IMAGE', scaleMode: normalizeScaleMode(scaleMode), imageHash: image.hash }
  };
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
        primary: primary ? { id: primary.id, name: primary.name, type: primary.type } : null
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
        placeOnPage(frame, params.x, params.y);
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
        placeOnPage(node, params.x, params.y);
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
        placeOnPage(text, params.x, params.y);
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
    case 'set_image': {
      const node = await figma.getNodeByIdAsync(String(params.nodeId ?? ''));
      if (!isSceneNode(node) || !('fills' in node)) {
        throw new Error('set_image requires a node that supports fills.');
      }
      const { paint } = imagePaintFromBase64(params.imageBase64, params.scaleMode);
      (node as GeometryMixin).fills = [paint];
      return { id: node.id, name: node.name };
    }
    case 'place_image': {
      const parent = await resolveParentContainer(params.parentId);
      const { paint, image } = imagePaintFromBase64(params.imageBase64, params.scaleMode);
      const size = await image.getSizeAsync();
      const rect = figma.createRectangle();
      if (params.name) {
        rect.name = String(params.name);
      }
      const width = params.width != null ? toNumber(params.width, size.width) : size.width;
      const height = params.height != null ? toNumber(params.height, size.height) : size.height;
      rect.resize(Math.max(1, width), Math.max(1, height));
      rect.fills = [paint];
      parent.appendChild(rect);
      if (parent.type === 'PAGE') {
        placeOnPage(rect, params.x, params.y);
      }
      return { ...selectAndReturn(rect), width, height };
    }
    case 'move': {
      const node = await figma.getNodeByIdAsync(String(params.nodeId ?? ''));
      if (!isSceneNode(node) || !('x' in node)) {
        throw new Error('move requires a node with a position.');
      }
      const layout = node as SceneNode & LayoutMixin;
      if (params.x != null) {
        layout.x = toNumber(params.x, layout.x);
      }
      if (params.y != null) {
        layout.y = toNumber(params.y, layout.y);
      }
      return { ...selectAndReturn(node), x: layout.x, y: layout.y };
    }
    case 'resize': {
      const node = await figma.getNodeByIdAsync(String(params.nodeId ?? ''));
      if (!isSceneNode(node) || !('resize' in node)) {
        throw new Error('resize is not supported for this node.');
      }
      const layout = node as SceneNode & LayoutMixin;
      const width = toNumber(params.width, layout.width);
      const height = toNumber(params.height, layout.height);
      layout.resize(Math.max(1, width), Math.max(1, height));
      return { ...selectAndReturn(node), width: layout.width, height: layout.height };
    }
    case 'reparent': {
      const node = await figma.getNodeByIdAsync(String(params.nodeId ?? ''));
      if (!isSceneNode(node)) {
        throw new Error('reparent requires a valid node.');
      }
      const parent = await resolveParentContainer(params.parentId);
      if (params.index != null) {
        parent.insertChild(toNumber(params.index, 0), node);
      } else {
        parent.appendChild(node);
      }
      if (parent.type === 'PAGE' && 'x' in node) {
        const layout = node as SceneNode & LayoutMixin;
        if (params.x != null) layout.x = toNumber(params.x, layout.x);
        if (params.y != null) layout.y = toNumber(params.y, layout.y);
      }
      return { ...selectAndReturn(node), parent: parent.id };
    }
    case 'delete': {
      const node = await figma.getNodeByIdAsync(String(params.nodeId ?? ''));
      if (!isSceneNode(node)) {
        throw new Error('delete requires a valid node.');
      }
      const info = { id: node.id, name: node.name };
      node.remove();
      return { deleted: info };
    }
    case 'clone': {
      const node = await figma.getNodeByIdAsync(String(params.nodeId ?? ''));
      if (!isSceneNode(node) || !('clone' in node)) {
        throw new Error('clone is not supported for this node.');
      }
      const copy = (node as SceneNode & { clone(): SceneNode }).clone();
      if (params.parentId != null) {
        const parent = await resolveParentContainer(params.parentId);
        parent.appendChild(copy);
      }
      if ('x' in copy) {
        const layout = copy as SceneNode & LayoutMixin;
        if (params.x != null) layout.x = toNumber(params.x, layout.x);
        if (params.y != null) layout.y = toNumber(params.y, layout.y);
      }
      return selectAndReturn(copy);
    }
    case 'group': {
      const ids = Array.isArray(params.nodeIds) ? params.nodeIds.map(String) : [];
      const nodes: SceneNode[] = [];
      for (const id of ids) {
        const found = await figma.getNodeByIdAsync(id);
        if (isSceneNode(found)) {
          nodes.push(found);
        }
      }
      if (nodes.length < 1) {
        throw new Error('group requires at least one valid node.');
      }
      const firstNode = nodes[0];
      const parent = (firstNode && firstNode.parent) || figma.currentPage;
      const group = figma.group(nodes, parent as BaseNode & ChildrenMixin);
      if (params.name) {
        group.name = String(params.name);
      }
      return selectAndReturn(group);
    }
    case 'ungroup': {
      const node = await figma.getNodeByIdAsync(String(params.nodeId ?? ''));
      if (!isSceneNode(node)) {
        throw new Error('ungroup requires a valid node.');
      }
      if (node.type !== 'GROUP') {
        throw new Error('ungroup requires a group node.');
      }
      const children = figma.ungroup(node);
      return { ungrouped: children.map((child) => ({ id: child.id, name: child.name })) };
    }
    case 'set_opacity': {
      const node = await figma.getNodeByIdAsync(String(params.nodeId ?? ''));
      if (!isSceneNode(node) || !('opacity' in node)) {
        throw new Error('set_opacity is not supported for this node.');
      }
      (node as SceneNode & MinimalBlendMixin).opacity = Math.max(
        0,
        Math.min(1, toNumber(params.opacity, 1))
      );
      return { id: node.id, name: node.name };
    }
    case 'set_rotation': {
      const node = await figma.getNodeByIdAsync(String(params.nodeId ?? ''));
      if (!isSceneNode(node) || !('rotation' in node)) {
        throw new Error('set_rotation is not supported for this node.');
      }
      (node as SceneNode & LayoutMixin).rotation = toNumber(params.rotation, 0);
      return { id: node.id, name: node.name };
    }
    case 'instantiate_component': {
      let component: ComponentNode | null = null;
      if (params.componentKey) {
        component = await figma.importComponentByKeyAsync(String(params.componentKey));
      } else if (params.componentId) {
        const found = await figma.getNodeByIdAsync(String(params.componentId));
        if (found && found.type === 'COMPONENT') {
          component = found;
        } else if (found && found.type === 'COMPONENT_SET') {
          component = found.defaultVariant;
        } else {
          throw new Error('componentId must reference a COMPONENT or COMPONENT_SET.');
        }
      } else {
        throw new Error('instantiate_component requires componentId or componentKey.');
      }
      if (!component) {
        throw new Error('Component not found.');
      }
      const instance = component.createInstance();
      const parent = await resolveParentContainer(params.parentId);
      parent.appendChild(instance);
      if (parent.type === 'PAGE') {
        placeOnPage(instance, params.x, params.y);
      }
      return selectAndReturn(instance);
    }
    case 'batch': {
      const ops = Array.isArray(params.operations) ? params.operations : [];
      const results: Array<{ ok: boolean; command: string; result?: unknown; error?: string }> = [];
      for (const entry of ops) {
        const op = (entry ?? {}) as { command?: unknown; params?: unknown };
        const subCommand = String(op.command ?? '');
        const subParams =
          op.params && typeof op.params === 'object' ? (op.params as Record<string, unknown>) : {};
        if (subCommand === 'batch') {
          results.push({ ok: false, command: subCommand, error: 'Nested batch is not allowed.' });
          continue;
        }
        try {
          results.push({ ok: true, command: subCommand, result: await runBridgeCommand(subCommand, subParams) });
        } catch (error) {
          results.push({
            ok: false,
            command: subCommand,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
      return { count: results.length, results };
    }
    case 'take_screenshot':
      return takeScreenshot(params);
    case 'console_logs':
      return readConsoleLogs(params);
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

// Export a node/selection/page to PNG (base64) so Claude can see the design.
async function takeScreenshot(
  params: Record<string, unknown>
): Promise<{ base64: string; mimeType: string; name: string; nodeId: string; width: number; height: number }> {
  const nodeId = typeof params.nodeId === 'string' ? params.nodeId : '';
  let target: BaseNode | null = null;
  if (nodeId) {
    target = await figma.getNodeByIdAsync(nodeId);
    if (!target) {
      throw new Error(`No node with id ${nodeId}.`);
    }
  } else if (figma.currentPage.selection.length > 0) {
    target = figma.currentPage.selection[0] ?? null;
  } else {
    target = figma.currentPage;
  }
  if (!target || !('exportAsync' in target)) {
    throw new Error('Nothing to screenshot. Select a node or pass a nodeId.');
  }
  const exportable = target as BaseNode & { exportAsync: SceneNode['exportAsync'] };

  const requested = toNumber(params.scale, 2);
  let scale = Math.max(0.5, Math.min(4, requested));
  const HARD_MAX = 4 * 1024 * 1024; // 4 MB ceiling on the bridge payload

  let bytes = await exportable.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: scale } });
  if (bytes.byteLength > 1.5 * 1024 * 1024 && scale > 1) {
    scale = 1;
    bytes = await exportable.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 1 } });
  }
  if (bytes.byteLength > HARD_MAX) {
    throw new Error(
      `Screenshot is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB; too large to send. Capture a smaller node via nodeId.`
    );
  }
  const width = 'width' in target ? Math.round((target as { width: number }).width * scale) : 0;
  const height = 'height' in target ? Math.round((target as { height: number }).height * scale) : 0;
  return {
    base64: figma.base64Encode(bytes),
    mimeType: 'image/png',
    name: target.name,
    nodeId: target.id,
    width,
    height
  };
}

// Return the captured console buffer (sandbox + forwarded UI logs).
function readConsoleLogs(params: Record<string, unknown>): {
  entries: LogEntry[];
  total: number;
} {
  const level = typeof params.level === 'string' ? params.level : '';
  const limit = Math.max(1, Math.min(LOG_BUFFER_MAX, toNumber(params.limit, 200)));
  const filtered = level ? logBuffer.filter((e) => e.level === level) : logBuffer.slice();
  const entries = filtered.slice(-limit);
  const total = filtered.length;
  if (params.clear === true) {
    logBuffer.length = 0;
  }
  return { entries, total };
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
  if (message.type === 'UI_CONSOLE_LOG') {
    pushLog(message.entry.level, 'ui', message.entry.text);
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

  if (message.type === 'EXPORT_HTML') {
    void exportHtml();
    return;
  }

  if (message.type === 'BRIDGE_COMMAND') {
    void handleBridgeCommand(message.id, message.command, message.params);
    return;
  }

  if (message.type === 'CREATE_DESIGN_TREE') {
    void createDesignTree(message);
    return;
  }

  if (message.type === 'APPLY_DESIGN_MD') {
    void applyDesignMdToFigma(message.content);
    return;
  }

  if (message.type === 'REFRESH_REQUEST') {
    invalidateCache();
    void computeAndPostAnalysis();
  }
};

void computeAndPostAnalysis();
