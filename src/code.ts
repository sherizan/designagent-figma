import {
  analyzeNodeCoreAsync,
  composeAnalysisPayload,
  type AnalysisCore
} from './core/analyze';
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

  if (message.type === 'REFRESH_REQUEST') {
    invalidateCache();
    void computeAndPostAnalysis();
  }
};

void computeAndPostAnalysis();
