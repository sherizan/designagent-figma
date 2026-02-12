import { analyzeNode } from './core/analyze';
import type { EmptyAnalysis, Preset } from './core/types';
import { PRESET_DEFINITIONS } from './core/types';
import type { ToPluginMessage, ToUIMessage } from './shared/messages';

const DEFAULT_PRESET: Preset = 'nextjs-tailwind-shadcn';
const PANEL_SIZE = {
  width: 560,
  height: 760
};

let activePreset: Preset = DEFAULT_PRESET;

function toEmptyAnalysis(preset: Preset): EmptyAnalysis {
  return {
    hasSelection: false,
    preset,
    message: 'Select a frame, instance, or section to generate DesignAgent output.'
  };
}

function postToUI(message: ToUIMessage): void {
  figma.ui.postMessage(message);
}

function computeAndPostAnalysis(): void {
  try {
    const selection = figma.currentPage.selection;

    if (selection.length === 0) {
      postToUI({ type: 'ANALYSIS_RESULT', payload: toEmptyAnalysis(activePreset) });
      return;
    }

    const selectedNode = selection[0];
    if (!selectedNode) {
      postToUI({ type: 'ANALYSIS_RESULT', payload: toEmptyAnalysis(activePreset) });
      return;
    }
    const analysis = analyzeNode(selectedNode, activePreset);
    postToUI({ type: 'ANALYSIS_RESULT', payload: analysis });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown plugin error';
    postToUI({ type: 'ERROR', message });
  }
}

figma.showUI(__html__, {
  width: PANEL_SIZE.width,
  height: PANEL_SIZE.height,
  themeColors: true
});

figma.on('selectionchange', computeAndPostAnalysis);
figma.on('currentpagechange', computeAndPostAnalysis);

figma.ui.onmessage = (message: ToPluginMessage) => {
  if (message.type === 'SET_PRESET') {
    if (message.preset in PRESET_DEFINITIONS) {
      activePreset = message.preset;
      computeAndPostAnalysis();
    }
    return;
  }

  if (message.type === 'REFRESH_REQUEST') {
    computeAndPostAnalysis();
  }
};

computeAndPostAnalysis();
