import type { AnalysisResult, Preset } from '../core/types';

export type ToUIMessage =
  | { type: 'ANALYSIS_RESULT'; payload: AnalysisResult }
  | { type: 'ERROR'; message: string };

export type ToPluginMessage =
  | { type: 'SET_PRESET'; preset: Preset }
  | { type: 'REFRESH_REQUEST' };
