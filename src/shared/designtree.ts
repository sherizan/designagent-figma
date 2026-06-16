// A serializable description of a rendered HTML subtree, produced by the plugin
// UI (which renders HTML in a real browser) and consumed by the sandbox to build
// Figma nodes. Coordinates are relative to the parent node; colors are CSS color
// strings (rgb/rgba/hex) parsed on the sandbox side.

export interface DesignTreeShadow {
  color: string;
  x: number;
  y: number;
  blur: number;
  spread: number;
}

export interface DesignTreeNode {
  kind: 'frame' | 'text' | 'image' | 'svg';
  x: number;
  y: number;
  width: number;
  height: number;
  fill?: string;
  gradient?: string; // raw CSS background-image gradient string, parsed sandbox-side
  stroke?: string;
  strokeWidth?: number;
  cornerRadius?: number;
  opacity?: number;
  shadow?: DesignTreeShadow;
  // text
  text?: string;
  fontSize?: number;
  fontWeight?: number;
  textAlign?: string;
  textColor?: string;
  letterSpacing?: number;
  lineHeight?: number;
  multiline?: boolean;
  // image / svg
  dataUrl?: string;
  svg?: string;
  // auto layout (when set, children flow instead of being absolutely placed)
  layout?: 'HORIZONTAL' | 'VERTICAL';
  itemSpacing?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  primaryAxisAlign?: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
  counterAxisAlign?: 'MIN' | 'CENTER' | 'MAX';
  stretch?: boolean; // fill the parent's counter axis (e.g. full-width in a column)
  absolute?: boolean; // pin at x/y inside an auto-layout parent (margin-inset children)
  grow?: boolean; // flex-grow > 0 on the main axis → Figma layoutGrow=1
  children: DesignTreeNode[];
}
