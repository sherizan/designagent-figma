import type { DesignTreeNode, DesignTreeShadow } from './shared/designtree';

// Render HTML in a hidden, SANDBOXED iframe and walk the laid-out DOM into a
// serializable tree (boxes + computed styles + text + images). Runs in the plugin
// UI iframe (a real browser); the sandbox plugin thread can't do this.
//
// Security: the render iframe uses sandbox="allow-same-origin" WITHOUT
// allow-scripts, so no JavaScript runs — not <script>, not inline handlers like
// onerror/onload. We only need layout + computed styles, never execution.
// allow-same-origin lets this document read the iframe's DOM to measure it.

function px(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function isVisibleColor(color: string): boolean {
  if (!color) return false;
  const c = color.replace(/\s+/g, '');
  return c !== 'rgba(0,0,0,0)' && c !== 'transparent';
}

function cssAlignToFigma(align: string): string {
  const v = (align || '').toLowerCase();
  if (v === 'center') return 'CENTER';
  if (v === 'right' || v === 'end') return 'RIGHT';
  if (v === 'justify') return 'JUSTIFIED';
  return 'LEFT';
}

function fontWeightToNumber(weight: string): number {
  if (weight === 'bold') return 700;
  if (weight === 'normal') return 400;
  const n = parseInt(weight, 10);
  return Number.isFinite(n) ? n : 400;
}

function parseBoxShadow(value: string): DesignTreeShadow | undefined {
  if (!value || value === 'none') return undefined;
  const colorMatch = /rgba?\([^)]+\)|#[0-9a-fA-F]+/.exec(value);
  const nums = value.replace(/rgba?\([^)]+\)/g, '').match(/-?\d+(?:\.\d+)?px/g);
  if (!nums || nums.length < 2) return undefined;
  const parts = nums.map(px);
  return {
    color: colorMatch ? colorMatch[0] : 'rgba(0,0,0,0.2)',
    x: parts[0] ?? 0,
    y: parts[1] ?? 0,
    blur: parts[2] ?? 0,
    spread: parts[3] ?? 0
  };
}

function getDirectText(el: Element): string {
  let text = '';
  el.childNodes.forEach((child) => {
    if (child.nodeType === 3) {
      text += child.textContent ?? '';
    }
  });
  return text.replace(/\s+/g, ' ').trim();
}

function buildNode(el: Element, win: Window, parentRect: DOMRect, isRoot: boolean): DesignTreeNode {
  const rect = el.getBoundingClientRect();
  const cs = win.getComputedStyle(el);

  const node: DesignTreeNode = {
    kind: 'frame',
    x: isRoot ? 0 : rect.left - parentRect.left,
    y: isRoot ? 0 : rect.top - parentRect.top,
    width: rect.width,
    height: rect.height,
    children: []
  };

  if (isVisibleColor(cs.backgroundColor)) {
    node.fill = cs.backgroundColor;
  }
  const borderWidth = px(cs.borderTopWidth);
  if (borderWidth > 0 && cs.borderTopStyle !== 'none' && isVisibleColor(cs.borderTopColor)) {
    node.stroke = cs.borderTopColor;
    node.strokeWidth = borderWidth;
  }
  const radius = px(cs.borderTopLeftRadius);
  if (radius > 0) {
    node.cornerRadius = radius;
  }
  const opacity = parseFloat(cs.opacity);
  if (Number.isFinite(opacity) && opacity < 1) {
    node.opacity = opacity;
  }
  const shadow = parseBoxShadow(cs.boxShadow);
  if (shadow) {
    node.shadow = shadow;
  }

  if (el.tagName === 'IMG') {
    const src = (el as HTMLImageElement).getAttribute('src') ?? '';
    if (src.startsWith('data:')) {
      node.kind = 'image';
      node.dataUrl = src;
    }
  }

  for (const child of Array.from(el.children)) {
    const childCs = win.getComputedStyle(child);
    if (childCs.display === 'none' || childCs.visibility === 'hidden') {
      continue;
    }
    const childRect = child.getBoundingClientRect();
    if (childRect.width <= 0 || childRect.height <= 0) {
      continue;
    }
    node.children.push(buildNode(child, win, rect, false));
  }

  const directText = getDirectText(el);
  if (directText && node.kind !== 'image') {
    node.children.push({
      kind: 'text',
      x: 0,
      y: 0,
      width: rect.width,
      height: rect.height,
      text: directText,
      fontSize: px(cs.fontSize),
      fontWeight: fontWeightToNumber(cs.fontWeight),
      textColor: cs.color,
      textAlign: cssAlignToFigma(cs.textAlign),
      children: []
    });
  }

  return node;
}

export function renderHtmlToTree(html: string, width = 1280): DesignTreeNode {
  const iframe = document.createElement('iframe');
  // No allow-scripts → nothing in the HTML executes (scripts or inline handlers).
  iframe.setAttribute('sandbox', 'allow-same-origin');
  iframe.style.position = 'fixed';
  iframe.style.left = '-100000px';
  iframe.style.top = '0';
  iframe.style.width = `${width}px`;
  iframe.style.height = '4000px';
  iframe.style.border = '0';
  iframe.style.background = '#ffffff';
  document.body.appendChild(iframe);
  try {
    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    if (!doc || !win) {
      throw new Error('Could not access the render frame.');
    }
    // Synchronously populate the sandboxed document (no scripts run).
    doc.open();
    doc.write(html);
    doc.close();
    const body = doc.body;
    if (!body) {
      throw new Error('Rendered HTML has no <body>.');
    }
    return buildNode(body, win, body.getBoundingClientRect(), true);
  } finally {
    document.body.removeChild(iframe);
  }
}
