import type { DesignTreeNode, DesignTreeShadow } from './shared/designtree';

// Render HTML in a hidden, SANDBOXED iframe and walk the laid-out DOM into a
// serializable tree (boxes + computed styles + text + images). Runs in the plugin
// UI iframe (a real browser); the sandbox plugin thread can't do this.
//
// Security: the render iframe uses sandbox="allow-same-origin" WITHOUT
// allow-scripts, so no JavaScript runs — not <script>, not inline handlers like
// onerror/onload. We only need layout + computed styles, never execution.

interface Box {
  left: number;
  top: number;
}

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

function isHidden(cs: CSSStyleDeclaration): boolean {
  return cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0;
}

function applyBoxStyles(node: DesignTreeNode, cs: CSSStyleDeclaration): void {
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
}

// Walk an element into a node, positioned relative to `parent`. Child elements
// recurse; text nodes are measured precisely with a Range so they land exactly
// where the browser drew them (beside icons, inline runs, etc.).
function buildNode(el: Element, win: Window, parent: Box): DesignTreeNode {
  const rect = el.getBoundingClientRect();
  const cs = win.getComputedStyle(el);

  const node: DesignTreeNode = {
    kind: 'frame',
    x: rect.left - parent.left,
    y: rect.top - parent.top,
    width: rect.width,
    height: rect.height,
    children: []
  };
  applyBoxStyles(node, cs);

  const tag = el.tagName.toLowerCase();

  if (tag === 'svg') {
    // Rebuilt as real vectors via figma.createNodeFromSvg in the sandbox.
    try {
      node.kind = 'svg';
      node.svg = new XMLSerializer().serializeToString(el);
    } catch {
      // fall back to an empty frame
    }
    return node;
  }

  if (tag === 'img') {
    const src = (el as HTMLImageElement).getAttribute('src') ?? '';
    if (src.startsWith('data:')) {
      node.kind = 'image';
      node.dataUrl = src;
      return node;
    }
  }

  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 1) {
      const childEl = child as Element;
      const childCs = win.getComputedStyle(childEl);
      if (isHidden(childCs)) continue;
      const cr = childEl.getBoundingClientRect();
      if (cr.width <= 0 || cr.height <= 0) continue;
      node.children.push(buildNode(childEl, win, rect));
    } else if (child.nodeType === 3) {
      const raw = (child.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (!raw) continue;
      const range = el.ownerDocument.createRange();
      range.selectNodeContents(child);
      const tr = range.getBoundingClientRect();
      if (tr.width <= 0 || tr.height <= 0) continue;
      // One client rect per visual line — >1 means the source text wrapped.
      const multiline = range.getClientRects().length > 1;
      // Bake text-transform into the string so glyphs match what was measured.
      const transform = cs.textTransform;
      const text =
        transform === 'uppercase'
          ? raw.toUpperCase()
          : transform === 'lowercase'
          ? raw.toLowerCase()
          : transform === 'capitalize'
          ? raw.replace(/\b\w/g, (c) => c.toUpperCase())
          : raw;
      const letterSpacing = cs.letterSpacing && cs.letterSpacing !== 'normal' ? px(cs.letterSpacing) : 0;
      const lineHeight = cs.lineHeight && cs.lineHeight !== 'normal' ? px(cs.lineHeight) : 0;
      node.children.push({
        kind: 'text',
        x: tr.left - rect.left,
        y: tr.top - rect.top,
        width: tr.width,
        height: tr.height,
        text,
        fontSize: px(cs.fontSize),
        fontWeight: fontWeightToNumber(cs.fontWeight),
        textColor: cs.color,
        textAlign: cssAlignToFigma(cs.textAlign),
        letterSpacing,
        lineHeight,
        multiline,
        children: []
      });
    }
  }

  return node;
}

export function renderHtmlToTree(html: string, width = 1280): DesignTreeNode {
  const iframe = document.createElement('iframe');
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
    doc.open();
    doc.write(html);
    doc.close();
    const body = doc.body;
    if (!body) {
      throw new Error('Rendered HTML has no <body>.');
    }

    // Trim to the content's bounding box so a vertically-centered card doesn't
    // become a giant mostly-empty frame.
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const el of Array.from(body.querySelectorAll('*'))) {
      if (isHidden(win.getComputedStyle(el))) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      left = Math.min(left, r.left);
      top = Math.min(top, r.top);
      right = Math.max(right, r.right);
      bottom = Math.max(bottom, r.bottom);
    }
    const content: Box = Number.isFinite(left) ? { left, top } : { left: 0, top: 0 };
    const rootWidth = Number.isFinite(left) ? right - left : body.getBoundingClientRect().width;
    const rootHeight = Number.isFinite(top) ? bottom - top : body.getBoundingClientRect().height;

    const root: DesignTreeNode = {
      kind: 'frame',
      x: 0,
      y: 0,
      width: rootWidth,
      height: rootHeight,
      children: []
    };

    for (const child of Array.from(body.childNodes)) {
      if (child.nodeType === 1) {
        const el = child as Element;
        if (isHidden(win.getComputedStyle(el))) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        root.children.push(buildNode(el, win, content));
      }
    }

    return root;
  } finally {
    document.body.removeChild(iframe);
  }
}
