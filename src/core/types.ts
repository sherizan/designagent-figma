export type Intent = 'screen' | 'component' | 'section';

export type Preset =
  | 'nextjs-tailwind-shadcn'
  | 'react-native-expo-nativewind'
  | 'web-html-css'
  | 'swiftui-ios'
  | 'jetpack-compose-android';

export type Mode = 'system-first' | 'fidelity-first';

export type PresetTarget =
  | 'web-nextjs'
  | 'native-rn-expo'
  | 'web-html-css'
  | 'native-swiftui'
  | 'native-compose';

export type PresetIcon = 'globe' | 'smartphone' | 'file-code' | 'apple' | 'bot';

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
  target: PresetTarget;
  icon: PresetIcon;
  projectContext: string;
  taskHint: string;
}

export const PRESET_DEFINITIONS: Record<Preset, PresetDefinition> = {
  'nextjs-tailwind-shadcn': {
    id: 'nextjs-tailwind-shadcn',
    label: 'Next.js + Tailwind',
    runtime: 'web',
    target: 'web-nextjs',
    icon: 'globe',
    projectContext:
      'Use Next.js App Router, TypeScript, and Tailwind CSS. Favor composition, server-safe defaults, and reusable primitives.',
    taskHint:
      'Produce App Router-friendly files and map design components to reusable web UI components; shadcn/ui is optional.'
  },
  'react-native-expo-nativewind': {
    id: 'react-native-expo-nativewind',
    label: 'React Native Expo',
    runtime: 'native',
    target: 'native-rn-expo',
    icon: 'smartphone',
    projectContext:
      'Use Expo + React Native with TypeScript and NativeWind. Prefer React Native core + DS wrappers, and keep navigation wiring as placeholders when unclear.',
    taskHint:
      'Produce screen/component code using RN layout rules, NativeWind classes, and explicit navigation placeholders where needed.'
  },
  'web-html-css': {
    id: 'web-html-css',
    label: 'Web (HTML/CSS)',
    runtime: 'web',
    target: 'web-html-css',
    icon: 'file-code',
    projectContext:
      'Use semantic HTML and plain CSS. Avoid framework-specific abstractions unless explicitly requested.',
    taskHint:
      'Produce clean HTML structure with maintainable CSS, keeping component extraction minimal and deterministic.'
  },
  'swiftui-ios': {
    id: 'swiftui-ios',
    label: 'SwiftUI',
    runtime: 'native',
    target: 'native-swiftui',
    icon: 'apple',
    projectContext:
      'Use SwiftUI for iOS with a clear View hierarchy, reusable View components, and tokenized styling via design system constants. Follow Apple Human Interface patterns.',
    taskHint:
      'Produce SwiftUI views with deterministic layout using VStack/HStack/ZStack, semantic modifiers, and explicit state bindings.'
  },
  'jetpack-compose-android': {
    id: 'jetpack-compose-android',
    label: 'Jetpack Compose',
    runtime: 'native',
    target: 'native-compose',
    icon: 'bot',
    projectContext:
      'Use Kotlin + Jetpack Compose with Material 3 where applicable. Favor reusable composables, explicit state hoisting, and tokenized theming.',
    taskHint:
      'Produce composables with deterministic Modifier chains, layout primitives (Row/Column/Box), and clear state/event contracts.'
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

export interface AnnotationEntry {
  label: string;
  category?: string;
  properties?: Record<string, string>;
}

export interface ResolvedVariable {
  id: string;
  name: string;
  collection: string;
  resolvedType: string;
  modes: Record<string, string>;
}

export interface ExportedAsset {
  nodeId: string;
  nodeName: string;
  format: 'PNG' | 'SVG';
  scale: number;
  dataUrl: string;
  byteLength: number;
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
  css?: Record<string, string>;
  annotations?: AnnotationEntry[];
  devStatus?: 'READY_FOR_DEV' | 'COMPLETED' | 'NONE';
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
  resolvedVariables?: ResolvedVariable[];
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
  applicableMax: number;
  applicable: Record<ScoreCategory, boolean>;
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
  link?: string;
}

export interface AnalysisPayload {
  hasSelection: true;
  preset: Preset;
  mode: Mode;
  selectedNode: SelectedNodeInfo;
  intent: Intent;
  flowCapable: boolean;
  uiSpec: UiSpec;
  coverageWarnings: string[];
  platformWarnings: string[];
  assets?: ExportedAsset[];
}

export interface EmptyAnalysis {
  hasSelection: false;
  preset: Preset;
  mode: Mode;
  flowCapable: false;
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
