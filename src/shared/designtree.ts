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
  kind: 'frame' | 'text' | 'image';
  x: number;
  y: number;
  width: number;
  height: number;
  fill?: string;
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
  // image
  dataUrl?: string;
  children: DesignTreeNode[];
}
