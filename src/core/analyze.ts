import { extractUiSpec } from './extract';
import { classifyIntent } from './intent';
import { generateBuildPrompt } from './prompt';
import { scoreUiSpec } from './score';
import type { AnalysisPayload, Preset, SelectedNodeInfo } from './types';

function getSelectedNodeInfo(node: SceneNode): SelectedNodeInfo {
  const selected: SelectedNodeInfo = {
    id: node.id,
    name: node.name,
    type: node.type
  };

  if ('width' in node) {
    selected.width = node.width;
  }

  if ('height' in node) {
    selected.height = node.height;
  }

  return selected;
}

export function analyzeNode(node: SceneNode, preset: Preset): AnalysisPayload {
  const selectedNode = getSelectedNodeInfo(node);
  const intent = classifyIntent(node);
  const uiSpec = extractUiSpec(node);

  const scoring = scoreUiSpec(uiSpec);

  const prompt = generateBuildPrompt({
    preset,
    intent,
    selectedNode,
    uiSpec,
    score: scoring.score,
    mode: scoring.mode,
    fallbackReasons: scoring.fallbackReasons
  });

  return {
    hasSelection: true,
    preset,
    selectedNode,
    intent,
    uiSpec,
    score: scoring.score,
    checklist: scoring.checklist,
    checklistByCategory: scoring.checklistByCategory,
    mode: scoring.mode,
    fallbackReasons: scoring.fallbackReasons,
    prompt
  };
}
