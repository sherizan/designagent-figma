import type { AnalysisResult, Mode, Preset } from '../core/types';

export type ToUIMessage =
  | {
      type: 'ANALYSIS_STARTED';
      nodeId: string;
      nodeName: string;
      nodeType: string;
    }
  | { type: 'ANALYSIS_RESULT'; payload: AnalysisResult }
  | {
      type: 'ISSUE_FIX_RESULT';
      nodeId: string;
      category: string;
      reason: string;
      status: 'fixed';
      detail: string;
    }
  | { type: 'DESIGN_MD_RESULT'; markdown: string; filename: string; frameCount: number }
  | { type: 'HTML_RESULT'; html: string; filename: string }
  | { type: 'BRIDGE_RESULT'; id: string; ok: boolean; result?: unknown; error?: string }
  | { type: 'ERROR'; message: string };

export type ToPluginMessage =
  | { type: 'SET_PRESET'; preset: Preset }
  | { type: 'SET_MODE'; mode: Mode }
  | { type: 'SET_FIGMA_LINK_BASE'; link: string }
  | { type: 'FOCUS_NODE'; nodeId: string }
  | {
      type: 'ADD_ANNOTATION';
      nodeId: string;
      nodeName: string;
      category: string;
      reason: string;
      suggestion: string;
    }
  | { type: 'EXPORT_DESIGN_MD' }
  | { type: 'EXPORT_HTML' }
  | { type: 'BRIDGE_COMMAND'; id: string; command: string; params: Record<string, unknown> }
  | { type: 'REFRESH_REQUEST' };
