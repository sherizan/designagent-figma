import { enrichUiSpec, exportAssetsForNode, extractUiSpec, loadAnnotationCategories } from './extract';
import { classifyIntent } from './intent';
import { scoreUiSpec } from './score';
import type {
  AnalysisPayload,
  ChecklistItem,
  ExportedAsset,
  Intent,
  Mode,
  ScoreCategory,
  ScoreResult,
  SelectedNodeInfo,
  UiSpec
} from './types';

interface AnalyzeOptions {
  linkBase?: string;
  includeAssets?: boolean;
  annotationCategories?: Map<string, string>;
}

export interface AnalysisCore {
  selectedNode: SelectedNodeInfo;
  intent: Intent;
  uiSpec: UiSpec;
  score: ScoreResult;
  checklist: ChecklistItem[];
  checklistByCategory: Record<ScoreCategory, ChecklistItem[]>;
  coverageWarnings: string[];
  assets?: ExportedAsset[];
}

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

export async function analyzeNodeCoreAsync(
  node: SceneNode,
  options?: AnalyzeOptions
): Promise<AnalysisCore> {
  const core = analyzeNodeCore(node, options);
  const categories = options?.annotationCategories ?? (await loadAnnotationCategories());
  await enrichUiSpec(core.uiSpec, node, { categories });
  if (options?.includeAssets !== false) {
    try {
      const assets = await exportAssetsForNode(node);
      if (assets.length > 0) {
        core.assets = assets;
      }
    } catch {
      // export is best-effort
    }
  }
  return core;
}

export function composeAnalysisPayload(
  core: AnalysisCore,
  mode: Mode,
  flowCapable: boolean
): AnalysisPayload {
  return {
    hasSelection: true,
    mode,
    selectedNode: core.selectedNode,
    intent: core.intent,
    flowCapable,
    uiSpec: core.uiSpec,
    coverageWarnings: core.coverageWarnings,
    assets: core.assets
  };
}

export function analyzeNode(
  node: SceneNode,
  mode: Mode,
  flowCapable: boolean,
  options?: AnalyzeOptions
): AnalysisPayload {
  const core = analyzeNodeCore(node, options);
  return composeAnalysisPayload(core, mode, flowCapable);
}
