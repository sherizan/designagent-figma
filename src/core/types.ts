export type Intent = 'screen' | 'component' | 'section';

export type Mode = 'system-first' | 'fidelity-first';

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
  // Native Figma grid layout (layoutMode === 'GRID'), captured for round-trip.
  gridRowCount?: number;
  gridColumnCount?: number;
  gridRowGap?: number;
  gridColumnGap?: number;
  constraints?: {
    horizontal?: string;
    vertical?: string;
  };
}

// A shader applied to a node's fill, stroke, or effect. Captured for the spec to
// describe; not parsed back to re-apply (shader ids are file-specific).
export interface ShaderSummary {
  surface: 'fill' | 'stroke' | 'effect';
  shaderId: string;
}

// A Figma Motion animation style applied to a node (Beta). Descriptive only —
// applied-style ids are file-specific and not parsed back.
export interface AnimationSummary {
  name: string;
  styleId?: string;
  duration?: number;
}

export interface VisualSummary {
  fills: 'none' | 'solid' | 'gradient' | 'image' | 'mixed' | 'unknown';
  fillColors?: string[];
  strokes: 'none' | 'solid' | 'mixed' | 'unknown';
  strokeColor?: string;
  cornerRadius: number | 'mixed' | 'undefined';
  effects: 'none' | 'shadow' | 'blur' | 'mixed';
  shaders?: ShaderSummary[];
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

export interface UiNodeSpec {
  id: string;
  name: string;
  type: string;
  // omitted when true — hidden subtrees are stripped at extraction, so only
  // the (rare) explicitly-false case would ever appear
  visible?: boolean;
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
  animations?: AnimationSummary[];
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
  mode: Mode;
  selectedNode: SelectedNodeInfo;
  intent: Intent;
  flowCapable: boolean;
  uiSpec: UiSpec;
}

export interface EmptyAnalysis {
  hasSelection: false;
  mode: Mode;
  flowCapable: false;
  message: string;
}

export type AnalysisResult = AnalysisPayload | EmptyAnalysis;
