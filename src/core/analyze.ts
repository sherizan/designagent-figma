import { extractUiSpec } from './extract';
import { classifyIntent } from './intent';
import { generatePromptBundle } from './prompt';
import { scoreUiSpec } from './score';
import type {
  AnalysisPayload,
  ChecklistItem,
  Intent,
  Mode,
  Preset,
  ScoreCategory,
  ScoreResult,
  SelectedNodeInfo,
  UiSpec
} from './types';
import { PRESET_DEFINITIONS } from './types';

interface AnalyzeOptions {
  linkBase?: string;
}

export interface AnalysisCore {
  selectedNode: SelectedNodeInfo;
  intent: Intent;
  uiSpec: UiSpec;
  score: ScoreResult;
  checklist: ChecklistItem[];
  checklistByCategory: Record<ScoreCategory, ChecklistItem[]>;
  coverageWarnings: string[];
}

type DetectedFrameFamily = 'ios' | 'android' | 'unknown';

const IOS_NAME_HINT = /\b(iphone|ios|ipad)\b/i;
const ANDROID_NAME_HINT = /\b(android|pixel|material)\b/i;

const IOS_SIZE_KEYS = new Set([
  '390x844',
  '393x852',
  '402x874',
  '420x912',
  '428x926',
  '430x932',
  '440x956'
]);

const ANDROID_SIZE_KEYS = new Set([
  '360x780',
  '360x800',
  '384x832',
  '411x891',
  '412x915',
  '412x917',
  '700x840'
]);

function toNodeIdParam(nodeId: string): string {
  return nodeId.replace(/:/g, '-');
}

function withNodeIdQuery(base: string, nodeId: string): string {
  const cleanBase = base.trim();
  const separator = cleanBase.includes('?') ? '&' : '?';
  return `${cleanBase}${separator}node-id=${encodeURIComponent(nodeId)}`;
}

function buildSelectionLink(node: SceneNode, linkBase?: string): string | undefined {
  const nodeId = toNodeIdParam(node.id);

  if (!figma.fileKey) {
    if (!linkBase) {
      return undefined;
    }
    return withNodeIdQuery(linkBase, nodeId);
  }

  const fileName = encodeURIComponent(figma.root.name || 'Untitled');
  return `https://www.figma.com/design/${figma.fileKey}/${fileName}?node-id=${encodeURIComponent(nodeId)}`;
}

function getSelectedNodeInfo(node: SceneNode, linkBase?: string): SelectedNodeInfo {
  const selected: SelectedNodeInfo = {
    id: node.id,
    name: node.name,
    type: node.type,
    link: buildSelectionLink(node, linkBase)
  };

  if ('width' in node) {
    selected.width = node.width;
  }

  if ('height' in node) {
    selected.height = node.height;
  }

  return selected;
}

function detectFrameFamily(selectedNode: SelectedNodeInfo): DetectedFrameFamily {
  if (selectedNode.type !== 'FRAME') {
    return 'unknown';
  }

  const name = selectedNode.name.toLowerCase();
  const isIosByName = IOS_NAME_HINT.test(name);
  const isAndroidByName = ANDROID_NAME_HINT.test(name);

  if (isIosByName && !isAndroidByName) {
    return 'ios';
  }

  if (isAndroidByName && !isIosByName) {
    return 'android';
  }

  if (typeof selectedNode.width !== 'number' || typeof selectedNode.height !== 'number') {
    return 'unknown';
  }

  const width = Math.round(selectedNode.width);
  const height = Math.round(selectedNode.height);
  const sizeKey = `${width}x${height}`;

  if (IOS_SIZE_KEYS.has(sizeKey)) {
    return 'ios';
  }

  if (ANDROID_SIZE_KEYS.has(sizeKey)) {
    return 'android';
  }

  return 'unknown';
}

function getPlatformWarnings(preset: Preset, selectedNode: SelectedNodeInfo): string[] {
  const target = PRESET_DEFINITIONS[preset].target;
  const detectedFamily = detectFrameFamily(selectedNode);
  const size =
    typeof selectedNode.width === 'number' && typeof selectedNode.height === 'number'
      ? `${Math.round(selectedNode.width)} x ${Math.round(selectedNode.height)}`
      : undefined;

  if (target === 'native-compose' && detectedFamily === 'ios') {
    return [
      `This frame looks like an iPhone size${size ? ` (${size})` : ''}, but the preset is Android. Switch preset or select an Android frame.`
    ];
  }

  if (target === 'native-swiftui' && detectedFamily === 'android') {
    return [
      `This frame looks like an Android size${size ? ` (${size})` : ''}, but the preset is iOS. Switch preset or select an iPhone frame.`
    ];
  }

  return [];
}

export function analyzeNodeCore(node: SceneNode, options?: AnalyzeOptions): AnalysisCore {
  const selectedNode = getSelectedNodeInfo(node, options?.linkBase);
  const intent = classifyIntent(node);
  const uiSpec = extractUiSpec(node);

  const scoring = scoreUiSpec(uiSpec);

  return {
    selectedNode,
    intent,
    uiSpec,
    score: scoring.score,
    checklist: scoring.checklist,
    checklistByCategory: scoring.checklistByCategory,
    coverageWarnings: scoring.coverageWarnings
  };
}

export function composeAnalysisPayload(
  core: AnalysisCore,
  preset: Preset,
  mode: Mode,
  flowCapable: boolean
): AnalysisPayload {
  const platformWarnings = getPlatformWarnings(preset, core.selectedNode);
  const prompts = generatePromptBundle({
    preset,
    mode,
    intent: core.intent,
    flowCapable,
    selectedNode: core.selectedNode,
    uiSpec: core.uiSpec,
    score: core.score,
    coverageWarnings: core.coverageWarnings
  });

  return {
    hasSelection: true,
    preset,
    mode,
    selectedNode: core.selectedNode,
    intent: core.intent,
    flowCapable,
    uiSpec: core.uiSpec,
    score: core.score,
    checklist: core.checklist,
    checklistByCategory: core.checklistByCategory,
    coverageWarnings: core.coverageWarnings,
    platformWarnings,
    prompt: prompts.full,
    promptShort: prompts.short,
    promptStrict: prompts.strict
  };
}

export function analyzeNode(
  node: SceneNode,
  preset: Preset,
  mode: Mode,
  flowCapable: boolean,
  options?: AnalyzeOptions
): AnalysisPayload {
  const core = analyzeNodeCore(node, options);
  return composeAnalysisPayload(core, preset, mode, flowCapable);
}
