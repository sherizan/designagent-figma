export type Intent = 'screen' | 'component' | 'section';

export type Preset = 'nextjs-tailwind-shadcn' | 'react-native-expo-nativewind';

export type Mode = 'system-first' | 'fidelity';

export type ScoreCategory =
  | 'Component Coverage'
  | 'Tokenization Coverage'
  | 'Layout Semantics'
  | 'Naming + Semantics'
  | 'Variant Completeness';

export interface PresetDefinition {
  id: Preset;
  label: string;
  runtime: 'web' | 'native';
  projectContext: string;
  taskHint: string;
}

export const PRESET_DEFINITIONS: Record<Preset, PresetDefinition> = {
  'nextjs-tailwind-shadcn': {
    id: 'nextjs-tailwind-shadcn',
    label: 'Next.js + Tailwind + shadcn',
    runtime: 'web',
    projectContext:
      'Use Next.js App Router, TypeScript, Tailwind CSS, and shadcn/ui components. Favor composition, server-safe defaults, and reusable primitives.',
    taskHint:
      'Produce App Router-friendly files and map design components to shadcn/ui first before custom primitives.'
  },
  'react-native-expo-nativewind': {
    id: 'react-native-expo-nativewind',
    label: 'React Native + Expo + NativeWind',
    runtime: 'native',
    projectContext:
      'Use Expo + React Native with TypeScript and NativeWind. Prefer React Native core + DS wrappers, and keep navigation wiring as placeholders when unclear.',
    taskHint:
      'Produce screen/component code using RN layout rules, NativeWind classes, and explicit navigation placeholders where needed.'
  }
};

export interface LayoutSummary {
  layoutMode?: string;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  itemSpacing?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  layoutPositioning?: string;
  constraints?: {
    horizontal?: string;
    vertical?: string;
  };
}

export interface VisualSummary {
  fills: 'none' | 'solid' | 'gradient' | 'image' | 'mixed' | 'unknown';
  strokes: 'none' | 'solid' | 'mixed' | 'unknown';
  cornerRadius: number | 'mixed' | 'undefined';
  effects: 'none' | 'shadow' | 'blur' | 'mixed';
}

export interface TextSummary {
  characters: string;
  fontFamily?: string;
  fontStyle?: string;
  fontSize?: number;
  lineHeight?: string;
  letterSpacing?: string;
  textCase?: string;
}

export type InstancePropertyValue = string | number | boolean;

export interface InstanceSummary {
  mainComponentName?: string;
  mainComponentKey?: string;
  componentProperties?: Record<string, InstancePropertyValue>;
}

export interface TokenHints {
  styleRefs: number;
  variableRefs: number;
  rawValueHints: number;
}

export interface UiNodeSpec {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  width?: number;
  height?: number;
  layout?: LayoutSummary;
  visual?: VisualSummary;
  tokenHints: TokenHints;
  text?: TextSummary;
  instance?: InstanceSummary;
  children: UiNodeSpec[];
}

export interface UiSpecStats {
  totalNodes: number;
  frames: number;
  instances: number;
  textNodes: number;
  autoLayoutFrames: number;
  absoluteNodes: number;
}

export interface TokenizationSummary {
  styleRefs: number;
  variableRefs: number;
  rawValueCandidates: number;
  coverage: number;
}

export interface UiSpec {
  version: string;
  root: UiNodeSpec;
  stats: UiSpecStats;
  tokenization: TokenizationSummary;
}

export interface ScoreBreakdown {
  componentCoverage: number;
  tokenizationCoverage: number;
  layoutSemantics: number;
  namingSemantics: number;
  variantCompleteness: number;
}

export interface ScoreDetails {
  interactiveCandidates: number;
  interactiveInstances: number;
  tokenRefs: number;
  rawTokenCandidates: number;
  autoLayoutRatio: number;
  absoluteRatio: number;
  semanticNameRatio: number;
  variantRatio: number;
}

export interface ScoreResult {
  total: number;
  breakdown: ScoreBreakdown;
  details: ScoreDetails;
}

export interface ChecklistItem {
  category: ScoreCategory;
  nodeId: string;
  nodeName: string;
  reason: string;
  suggestion: string;
}

export interface SelectedNodeInfo {
  id: string;
  name: string;
  type: string;
  width?: number;
  height?: number;
}

export interface AnalysisPayload {
  hasSelection: true;
  preset: Preset;
  selectedNode: SelectedNodeInfo;
  intent: Intent;
  uiSpec: UiSpec;
  score: ScoreResult;
  checklist: ChecklistItem[];
  checklistByCategory: Record<ScoreCategory, ChecklistItem[]>;
  mode: Mode;
  fallbackReasons: string[];
  prompt: string;
}

export interface EmptyAnalysis {
  hasSelection: false;
  preset: Preset;
  message: string;
}

export type AnalysisResult = AnalysisPayload | EmptyAnalysis;

export const SCORE_WEIGHTS = {
  componentCoverage: 30,
  tokenizationCoverage: 25,
  layoutSemantics: 20,
  namingSemantics: 15,
  variantCompleteness: 10
} as const;

export const SCORE_CATEGORIES: ScoreCategory[] = [
  'Component Coverage',
  'Tokenization Coverage',
  'Layout Semantics',
  'Naming + Semantics',
  'Variant Completeness'
];
