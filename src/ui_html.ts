import type { DesignTreeNode, DesignTreeShadow, TextRun } from './shared/designtree';

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

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] ?? 0 : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
}

function primaryFromJustify(j: string): 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN' {
  if (j.includes('center')) return 'CENTER';
  if (j.includes('space-')) return 'SPACE_BETWEEN';
  if (j.includes('end')) return 'MAX';
  return 'MIN';
}

function counterFromItems(a: string): 'MIN' | 'CENTER' | 'MAX' {
  if (a.includes('center')) return 'CENTER';
  if (a.includes('end')) return 'MAX';
  return 'MIN';
}

interface LayoutInfo {
  layout: 'HORIZONTAL' | 'VERTICAL';
  itemSpacing: number;
  padding: { t: number; r: number; b: number; l: number };
  primary: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
  counter: 'MIN' | 'CENTER' | 'MAX';
}

// Map an element's CSS layout to Figma Auto Layout, or null for absolute fallback.
function computeLayout(el: Element, cs: CSSStyleDeclaration, win: Window): LayoutInfo | null {
  const padding = {
    t: px(cs.paddingTop),
    r: px(cs.paddingRight),
    b: px(cs.paddingBottom),
    l: px(cs.paddingLeft)
  };
  const display = cs.display;

  if (display === 'flex' || display === 'inline-flex') {
    const layout = cs.flexDirection.indexOf('column') === 0 ? 'VERTICAL' : 'HORIZONTAL';
    const gapProp = layout === 'VERTICAL' ? cs.rowGap : cs.columnGap;
    const gap = px(
      gapProp && gapProp !== 'normal' ? gapProp : cs.gap && cs.gap !== 'normal' ? cs.gap : '0'
    );
    return {
      layout,
      itemSpacing: gap,
      padding,
      primary: primaryFromJustify(cs.justifyContent),
      counter: counterFromItems(cs.alignItems)
    };
  }

  if (display === 'block' || display === 'list-item' || display === 'flow-root') {
    const kids = Array.from(el.children).filter((c) => {
      const ccs = win.getComputedStyle(c);
      if (ccs.display === 'none' || ccs.visibility === 'hidden') return false;
      const r = c.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (kids.length < 2) return null;
    const rects = kids.map((c) => c.getBoundingClientRect());
    const gaps: number[] = [];
    for (let i = 0; i < rects.length - 1; i += 1) {
      const a = rects[i];
      const b = rects[i + 1];
      if (!a || !b) continue;
      if (b.top < a.bottom - 2) return null; // not a clean vertical stack
      gaps.push(Math.max(0, b.top - a.bottom));
    }
    return {
      layout: 'VERTICAL',
      itemSpacing: Math.round(median(gaps)),
      padding,
      primary: 'MIN',
      counter: 'MIN'
    };
  }

  return null;
}

function applyBoxStyles(node: DesignTreeNode, cs: CSSStyleDeclaration): void {
  if (isVisibleColor(cs.backgroundColor)) {
    node.fill = cs.backgroundColor;
  }
  const bgImage = cs.backgroundImage;
  if (bgImage && /gradient\(/i.test(bgImage)) {
    node.gradient = bgImage;
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

function isInlineLevel(display: string): boolean {
  return display === 'inline' || display === 'inline-block';
}

// True when `el`'s content is text interleaved with inline, text-only elements
// (one level deep) — e.g. a heading with a colored <span>. Such an element must
// become ONE Figma text node with per-range style runs, not separate frames
// (which overlap when the line wraps). Any block/flex child, or an inline element
// that itself contains elements, disqualifies it (→ existing per-child path).
function isInlineTextContainer(el: Element, win: Window): boolean {
  let hasText = false;
  let hasInlineEl = false;
  for (const c of Array.from(el.childNodes)) {
    if (c.nodeType === 3) {
      if ((c.textContent ?? '').trim()) hasText = true;
    } else if (c.nodeType === 1) {
      const ce = c as Element;
      const ccs = win.getComputedStyle(ce);
      if (isHidden(ccs)) continue;
      if (!isInlineLevel(ccs.display)) return false;
      if (ce.children.length > 0) return false; // nested elements — too complex
      hasInlineEl = true;
    }
  }
  return hasText && hasInlineEl;
}

// Build a single text node for an inline-text container, with style runs for
// each inline element child. Whitespace is collapsed across the whole string
// while run offsets are tracked on the normalized output. Returns null if the
// combined text is empty (caller falls back to the per-child path).
function buildInlineTextNode(
  el: Element,
  cs: CSSStyleDeclaration,
  win: Window,
  rect: DOMRect
): DesignTreeNode | null {
  const baseColor = cs.color;
  const baseWeight = fontWeightToNumber(cs.fontWeight);

  let out = '';
  let pendingSpace = false;
  // Append `s` with whitespace collapsed; return the [start,end) range of the
  // non-space characters it contributed (a leading collapsed space belongs to
  // the gap, not the run).
  const appendNormalized = (s: string): { start: number; end: number } => {
    let start = -1;
    for (const ch of s) {
      if (/\s/.test(ch)) {
        if (out.length > 0) pendingSpace = true;
      } else {
        if (pendingSpace) {
          out += ' ';
          pendingSpace = false;
        }
        if (start === -1) start = out.length;
        out += ch;
      }
    }
    const end = out.length;
    return { start: start === -1 ? end : start, end };
  };

  const runs: TextRun[] = [];
  for (const c of Array.from(el.childNodes)) {
    if (c.nodeType === 3) {
      appendNormalized(c.textContent ?? '');
    } else if (c.nodeType === 1) {
      const ce = c as Element;
      const ccs = win.getComputedStyle(ce);
      if (isHidden(ccs)) continue;
      const { start, end } = appendNormalized(ce.textContent ?? '');
      if (end <= start) continue;
      const run: TextRun = { start, end };
      if (isVisibleColor(ccs.color) && ccs.color !== baseColor) run.color = ccs.color;
      const w = fontWeightToNumber(ccs.fontWeight);
      if (w !== baseWeight) run.fontWeight = w;
      if (run.color !== undefined || run.fontWeight !== undefined) runs.push(run);
    }
  }

  if (!out) return null;

  const transform = cs.textTransform;
  const text =
    transform === 'uppercase'
      ? out.toUpperCase()
      : transform === 'lowercase'
      ? out.toLowerCase()
      : transform === 'capitalize'
      ? out.replace(/\b\w/g, (c) => c.toUpperCase())
      : out;

  // Measure the element's text content precisely (matches the per-text-node path).
  const range = el.ownerDocument.createRange();
  range.selectNodeContents(el);
  const tr = range.getBoundingClientRect();
  const multiline = range.getClientRects().length > 1;
  const letterSpacing = cs.letterSpacing && cs.letterSpacing !== 'normal' ? px(cs.letterSpacing) : 0;
  const lineHeight = cs.lineHeight && cs.lineHeight !== 'normal' ? px(cs.lineHeight) : 0;

  return {
    kind: 'text',
    x: tr.left - rect.left,
    y: tr.top - rect.top,
    width: tr.width,
    height: tr.height,
    text,
    fontSize: px(cs.fontSize),
    fontWeight: baseWeight,
    textColor: cs.color,
    textAlign: cssAlignToFigma(cs.textAlign),
    letterSpacing,
    lineHeight,
    multiline,
    runs: runs.length > 0 ? runs : undefined,
    children: []
  };
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

  const lay = computeLayout(el, cs, win);
  if (!lay && isInlineTextContainer(el, win)) {
    const merged = buildInlineTextNode(el, cs, win, rect);
    if (merged) {
      node.children.push(merged);
      return node;
    }
  }
  if (lay) {
    node.layout = lay.layout;
    node.itemSpacing = lay.itemSpacing;
    node.paddingTop = lay.padding.t;
    node.paddingRight = lay.padding.r;
    node.paddingBottom = lay.padding.b;
    node.paddingLeft = lay.padding.l;
    node.primaryAxisAlign = lay.primary;
    node.counterAxisAlign = lay.counter;
  }
  // For a vertical Auto Layout, a child as wide as the content box should fill width.
  const isVertical = lay?.layout === 'VERTICAL';
  const contentWidth = isVertical ? rect.width - lay!.padding.l - lay!.padding.r : 0;
  // Left/right edges of the container's content box, in viewport coords.
  const contentLeft = rect.left + (lay ? lay.padding.l : 0);
  const contentRight = rect.right - (lay ? lay.padding.r : 0);

  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 1) {
      const childEl = child as Element;
      const childCs = win.getComputedStyle(childEl);
      if (isHidden(childCs)) continue;
      const cr = childEl.getBoundingClientRect();
      if (cr.width <= 0 || cr.height <= 0) continue;
      const childNode = buildNode(childEl, win, rect);
      if (contentWidth > 0 && cr.width >= contentWidth - 2) {
        childNode.stretch = true;
      } else if (lay) {
        // Auto Layout ignores child margins, so a child inset on BOTH sides
        // (e.g. a CTA with `margin: 0 28px`) would snap to the container edge.
        // Pin it absolutely to keep its measured position.
        const leftInset = cr.left - contentLeft;
        const rightInset = contentRight - cr.right;
        if (leftInset > 1.5 && rightInset > 1.5) {
          childNode.absolute = true;
        }
      }
      if (parseFloat(childCs.flexGrow) > 0) {
        childNode.grow = true;
      }
      node.children.push(childNode);
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
