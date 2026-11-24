import type { DesignTreeTrack, DesignTreeNode, DesignTreeShadow, TextRun } from './shared/designtree';

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

type PrimaryAlign = NonNullable<DesignTreeNode['primaryAxisAlign']>;

function primaryFromJustify(j: string): PrimaryAlign {
  if (j.includes('center')) return 'CENTER';
  if (j.includes('space-around')) return 'SPACE_AROUND';
  if (j.includes('space-evenly')) return 'SPACE_EVENLY';
  if (j.includes('space-')) return 'SPACE_BETWEEN';
  if (j.includes('end')) return 'MAX';
  return 'MIN';
}

// CSS gap value → px, treating 'normal' (the unset computed value) as 0.
function gapPx(value: string): number {
  return value && value !== 'normal' ? px(value) : 0;
}

// `text-wrap: balance | pretty` → Figma textWrapStyle. Reads the longhand first
// (Chromium ≥130 exposes text-wrap-style), then the shorthand.
function textWrapFrom(cs: CSSStyleDeclaration): DesignTreeNode['textWrap'] {
  const v = cs.getPropertyValue('text-wrap-style') || cs.getPropertyValue('text-wrap');
  if (v.includes('balance')) return 'BALANCE';
  if (v.includes('pretty')) return 'PRETTY';
  return undefined;
}

// `font-variation-settings: "wght" 550, "slnt" -5` → { wght: 550, slnt: -5 }.
function fontVariationFrom(cs: CSSStyleDeclaration): Record<string, number> | undefined {
  const v = cs.getPropertyValue('font-variation-settings');
  if (!v || v === 'normal') return undefined;
  const out: Record<string, number> = {};
  for (const m of v.matchAll(/["']([a-zA-Z0-9]{4})["']\s+(-?[\d.]+)/g)) {
    const axis = m[1];
    const n = parseFloat(m[2] ?? '');
    if (axis && Number.isFinite(n)) out[axis] = n;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function counterFromItems(a: string): 'MIN' | 'CENTER' | 'MAX' {
  if (a.includes('center')) return 'CENTER';
  if (a.includes('end')) return 'MAX';
  return 'MIN';
}

interface LayoutInfo {
  layout: 'HORIZONTAL' | 'VERTICAL' | 'GRID';
  itemSpacing: number;
  padding: { t: number; r: number; b: number; l: number };
  primary: PrimaryAlign;
  counter: 'MIN' | 'CENTER' | 'MAX';
  gridColumns?: number;
  gridColumnGap?: number;
  gridRowGap?: number;
  // flex: CSS allows wrapping (whether children actually wrapped is measured later)
  wrapCss?: boolean;
  crossGap?: number;
  alignContentBetween?: boolean;
  // grid: resolved px tracks (for placing children) and their Figma track types
  colPx?: number[];
  rowPx?: number[];
  gridCols?: DesignTreeTrack[];
  gridRows?: DesignTreeTrack[];
}

// Resolved px sizes from a computed grid-template-* value ("[a] 200px 1fr" never appears
// here: the browser resolves every track to px, but named lines stay in as "[name]").
function pxTracks(value: string): number[] {
  return value
    .replace(/\[[^\]]*\]/g, ' ')
    .split(/\s+/)
    .filter((t) => /^[\d.]+px$/.test(t))
    .map((t) => parseFloat(t));
}

// Split a track list at top level (spaces inside minmax()/repeat() do not split) and
// expand repeat(N, …). Returns null for anything we cannot count (auto-fill, subgrid…).
function expandTracks(value: string): string[] | null {
  const src = value.replace(/\[[^\]]*\]/g, ' ').trim();
  if (!src || src === 'none' || /subgrid|masonry|auto-fill|auto-fit/.test(src)) return null;
  const tokens: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of src) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (/\s/.test(ch) && depth === 0) {
      if (current) tokens.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  const out: string[] = [];
  for (const token of tokens) {
    const m = /^repeat\(\s*(\d+)\s*,(.*)\)$/.exec(token);
    if (m) {
      const inner = expandTracks(m[2] ?? '');
      if (!inner) return null;
      for (let i = 0; i < Number(m[1]); i += 1) out.push(...inner);
    } else if (token.indexOf('repeat(') === 0) {
      return null;
    } else {
      out.push(token);
    }
  }
  return out;
}

// The fr value a track flexes by, or 0 when it does not flex ("1fr", "minmax(0, 2fr)").
function trackFr(token: string): number {
  const m = /^([\d.]+)fr$/.exec(token) ?? /^minmax\(.*,\s*([\d.]+)fr\s*\)$/.exec(token);
  return m ? parseFloat(m[1] ?? '0') : 0;
}

// Figma track types for a grid axis. `authored` is the computed (not resolved) track list
// when the browser exposes it; `px` are the resolved sizes. fr tracks become FLEX only when
// the measured sizes really are proportional to their fr values (content can force an fr
// track wider than its share) — otherwise every track is pinned at its measured px.
function classifyTracks(authored: string, px: number[]): DesignTreeTrack[] {
  const fixed = (): DesignTreeTrack[] => px.map((value) => ({ type: 'FIXED' as const, value }));
  const tokens = authored ? expandTracks(authored) : null;
  if (!tokens || tokens.length !== px.length) {
    // No usable source: equal tracks stay Figma's default (FLEX 1), unequal ones are pinned.
    const first = px[0] ?? 0;
    return px.every((v) => Math.abs(v - first) <= 1) ? px.map(() => ({ type: 'FLEX' as const, value: 1 })) : fixed();
  }
  const frs = tokens.map(trackFr);
  let unit = 0;
  for (let i = 0; i < frs.length; i += 1) {
    const fr = frs[i] ?? 0;
    if (fr <= 0) continue;
    const perFr = (px[i] ?? 0) / fr;
    if (unit === 0) unit = perFr;
    else if (Math.abs(perFr - unit) > 1.5) return fixed();
  }
  return px.map((value, i) => {
    const fr = frs[i] ?? 0;
    return fr > 0 ? { type: 'FLEX' as const, value: fr } : { type: 'FIXED' as const, value };
  });
}

// Computed (as-authored) value of a property, where the browser supports Typed OM.
function authoredValue(el: Element, prop: string): string {
  try {
    const map = (el as Element & { computedStyleMap?: () => { get(p: string): unknown } }).computedStyleMap?.();
    const value = map?.get(prop);
    return value ? String(value) : '';
  } catch {
    return '';
  }
}

// Index of the track containing `pos` along one axis, or -1 when it falls outside every
// track (in a gap, or the grid is offset by justify/align-content).
function trackAt(starts: number[], sizes: number[], pos: number): number {
  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i] ?? 0;
    if (pos >= start - 1.5 && pos <= start + (sizes[i] ?? 0) + 1.5) return i;
  }
  return -1;
}

// Work out each grid child's cell and spans from where the browser drew it. That covers
// grid-area, line placement, spans and dense flow without parsing any of them. Returns
// true when the children need explicit cells (they differ from plain row-major flow) and
// every one of them could be placed without overlap.
function placeGridChildren(
  lay: LayoutInfo,
  origin: { left: number; top: number },
  flow: Array<{ rect: DOMRect; child: DesignTreeNode }>
): boolean {
  const colPx = lay.colPx ?? [];
  const rowPx = lay.rowPx ?? [];
  if (colPx.length === 0 || rowPx.length === 0 || flow.length === 0) return false;
  const starts = (sizes: number[], from: number, gap: number): number[] => {
    const out: number[] = [];
    let at = from;
    for (const size of sizes) {
      out.push(at);
      at += size + gap;
    }
    return out;
  };
  const colStarts = starts(colPx, origin.left, lay.gridColumnGap ?? 0);
  const rowStarts = starts(rowPx, origin.top, lay.gridRowGap ?? 0);
  const taken = new Set<string>();
  const cells: Array<{ row: number; col: number; rowSpan: number; colSpan: number }> = [];
  for (const f of flow) {
    const col = trackAt(colStarts, colPx, f.rect.left);
    const row = trackAt(rowStarts, rowPx, f.rect.top);
    // The far edges, nudged inwards so an item that exactly fills its cell stays in it.
    const colEnd = trackAt(colStarts, colPx, f.rect.right - 2);
    const rowEnd = trackAt(rowStarts, rowPx, f.rect.bottom - 2);
    if (col < 0 || row < 0) return false;
    const colSpan = colEnd >= col ? colEnd - col + 1 : 1;
    const rowSpan = rowEnd >= row ? rowEnd - row + 1 : 1;
    for (let r = row; r < row + rowSpan; r += 1) {
      for (let c = col; c < col + colSpan; c += 1) {
        const key = `${r}:${c}`;
        if (taken.has(key)) return false;
        taken.add(key);
      }
    }
    cells.push({ row, col, rowSpan, colSpan });
  }
  const cols = colPx.length;
  const plainFlow = cells.every(
    (cell, i) => cell.rowSpan === 1 && cell.colSpan === 1 && cell.row === Math.floor(i / cols) && cell.col === i % cols
  );
  if (plainFlow) return false;
  flow.forEach((f, i) => {
    const cell = cells[i];
    if (!cell) return;
    f.child.gridRow = cell.row;
    f.child.gridColumn = cell.col;
    f.child.gridRowSpan = cell.rowSpan;
    f.child.gridColumnSpan = cell.colSpan;
  });
  return true;
}

// A CSS min-/max- size in px, kept only when it agrees with the measured size (so applying
// it in Figma can never change how the element renders). Percentages and keywords are skipped.
function limitPx(value: string, measured: number, kind: 'min' | 'max'): number | undefined {
  if (!value || !/^[\d.]+px$/.test(value)) return undefined;
  const n = parseFloat(value);
  if (!(n > 0)) return undefined;
  return kind === 'min' ? (n <= measured + 0.5 ? n : undefined) : n >= measured - 0.5 ? n : undefined;
}

// Layer name for a rendered element: data-name → id → aria-label → first plain class → tag.
function layerName(el: Element): string {
  const cls = (el.getAttribute('class') ?? '').trim().split(/\s+/)[0] ?? '';
  const pick =
    el.getAttribute('data-name') ||
    el.id ||
    el.getAttribute('aria-label') ||
    (/^[a-zA-Z][\w-]*$/.test(cls) ? cls : '');
  return (pick || el.tagName.toLowerCase()).slice(0, 60);
}

// A wrapper whose only content is wrapped text becomes a vertical Auto Layout that hugs
// its text, so when Figma breaks lines differently from the browser the wrapper grows
// (and pushes its siblings) instead of letting the text spill over them.
function growWithText(node: DesignTreeNode, cs: CSSStyleDeclaration): void {
  node.layout = 'VERTICAL';
  node.itemSpacing = 0;
  node.paddingTop = px(cs.paddingTop);
  node.paddingRight = px(cs.paddingRight);
  node.paddingBottom = px(cs.paddingBottom);
  node.paddingLeft = px(cs.paddingLeft);
  node.primaryAxisAlign = 'MIN';
  node.counterAxisAlign = cs.textAlign === 'center' ? 'CENTER' : cs.textAlign === 'right' ? 'MAX' : 'MIN';
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
      counter: counterFromItems(cs.alignItems),
      // wrap-reverse stacks lines the other way; Figma has no equivalent, so it is left alone
      wrapCss: cs.flexWrap === 'wrap',
      crossGap: gapPx(layout === 'VERTICAL' ? cs.columnGap : cs.rowGap),
      alignContentBetween: cs.alignContent === 'space-between'
    };
  }

  if (display === 'grid' || display === 'inline-grid') {
    // Computed grid-template-columns is a resolved px track list ("200px 200px 200px"),
    // so the token count is the column count. Rows are left to Figma's auto-flow.
    const colPx = pxTracks(cs.gridTemplateColumns);
    const rowPx = pxTracks(cs.gridTemplateRows);
    const cols =
      colPx.length || cs.gridTemplateColumns.split(/\s+/).filter((t) => t && t !== 'none').length;
    return {
      layout: 'GRID',
      itemSpacing: 0,
      padding,
      primary: 'MIN',
      counter: 'MIN',
      gridColumns: Math.max(1, cols),
      gridColumnGap: gapPx(cs.columnGap),
      gridRowGap: gapPx(cs.rowGap),
      colPx,
      rowPx,
      gridCols: classifyTracks(authoredValue(el, 'grid-template-columns'), colPx),
      gridRows: classifyTracks(authoredValue(el, 'grid-template-rows'), rowPx)
    };
  }

  if (display === 'block' || display === 'list-item' || display === 'flow-root') {
    const kids = Array.from(el.children).filter((c) => {
      const ccs = win.getComputedStyle(c);
      if (ccs.display === 'none' || ccs.visibility === 'hidden') return false;
      const r = c.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (kids.length === 0) return null;
    if (kids.length === 1) {
      // One child: an Auto Layout column whose padding is the measured inset on each side,
      // so the frame hugs the child's height (wrapped text can grow) without moving it.
      const r = el.getBoundingClientRect();
      const c = kids[0]!.getBoundingClientRect();
      const l = Math.max(0, c.left - r.left);
      const rr = Math.max(0, r.right - c.right);
      return {
        layout: 'VERTICAL',
        itemSpacing: 0,
        padding: { t: Math.max(0, c.top - r.top), r: rr, b: Math.max(0, r.bottom - c.bottom), l },
        primary: 'MIN',
        counter: Math.abs(l - rr) <= 1.5 && l > 1.5 ? 'CENTER' : rr < 1.5 && l > 1.5 ? 'MAX' : 'MIN'
      };
    }
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

// Detect overlapping children (negative margins) and preserve the overlap:
// uniform overlap → a single negative itemSpacing (stays an editable Auto Layout
// row); non-uniform overlap → pin each flow child absolutely at its measured x/y.
// `flow` are the element children emitted as flow nodes (not absolute/stretch),
// each paired with the DesignTreeNode pushed for it, in document order.
function applyOverlap(
  node: DesignTreeNode,
  layout: 'HORIZONTAL' | 'VERTICAL',
  flow: Array<{ rect: DOMRect; child: DesignTreeNode }>
): void {
  if (flow.length < 2) return;
  const horizontal = layout === 'HORIZONTAL';
  const gaps: number[] = [];
  for (let i = 0; i < flow.length - 1; i += 1) {
    const a = flow[i];
    const b = flow[i + 1];
    if (!a || !b) return;
    gaps.push(horizontal ? b.rect.left - a.rect.right : b.rect.top - a.rect.bottom);
  }
  if (!gaps.some((g) => g < -1)) return; // act only if at least one pair overlaps
  const min = Math.min(...gaps);
  const max = Math.max(...gaps);
  // Uniform overlap (all gaps within ~1px) → one negative itemSpacing; any spread
  // (mixed positive/negative gaps included) → pin each child at its measured x/y.
  if (max - min <= 1) {
    node.itemSpacing = Math.round((min + max) / 2);
  } else {
    for (const f of flow) {
      f.child.absolute = true;
    }
  }
}

function applyBoxStyles(node: DesignTreeNode, cs: CSSStyleDeclaration): void {
  if (isVisibleColor(cs.backgroundColor)) {
    node.fill = cs.backgroundColor;
  }
  const bgImage = cs.backgroundImage;
  if (bgImage && /gradient\(/i.test(bgImage)) {
    node.gradient = bgImage; // may hold several layers; the sandbox splits them
  }
  {
    // url(data:…) only — the MCP server inlines local/remote images before rendering.
    const m = /url\(["']?(data:image\/[^"')]+)["']?\)/i.exec(bgImage ?? '');
    if (m && m[1]) {
      node.bgImage = m[1];
      node.bgImageMode = /^repeat/.test(cs.backgroundRepeat) && !/no-repeat/.test(cs.backgroundRepeat)
        ? 'TILE'
        : cs.backgroundSize === 'contain'
          ? 'FIT'
          : 'FILL';
    }
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
  const backdrop = /blur\(\s*([\d.]+)px\s*\)/i.exec(cs.backdropFilter ?? '');
  if (backdrop && backdrop[1]) {
    node.backdropBlur = parseFloat(backdrop[1]);
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
      const ceTag = ce.tagName.toLowerCase();
      if (ceTag === 'img' || ceTag === 'br' || ceTag === 'input' || ceTag === 'hr' || ceTag === 'svg') return false;
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
  // Wrapped text fills its container: the Range rect is only the widest line (and with
  // text-wrap: balance, much narrower), which would make Figma re-wrap at the wrong width.
  const padL = px(cs.paddingLeft);
  const contentW = rect.width - padL - px(cs.paddingRight);

  return {
    kind: 'text',
    x: multiline && contentW > tr.width ? padL : tr.left - rect.left,
    y: tr.top - rect.top,
    width: multiline ? Math.max(tr.width, contentW) : tr.width,
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
    textWrap: textWrapFrom(cs),
    fontVariation: fontVariationFrom(cs),
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
    name: layerName(el),
    children: []
  };
  applyBoxStyles(node, cs);
  node.minWidth = limitPx(cs.minWidth, rect.width, 'min');
  node.maxWidth = limitPx(cs.maxWidth, rect.width, 'max');
  node.minHeight = limitPx(cs.minHeight, rect.height, 'min');
  node.maxHeight = limitPx(cs.maxHeight, rect.height, 'max');

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

  if (isInlineTextContainer(el, win)) {
    const merged = buildInlineTextNode(el, cs, win, rect);
    if (merged) {
      node.children.push(merged);
      if (merged.multiline) growWithText(node, cs);
      return node;
    }
  }
  const lay = computeLayout(el, cs, win);
  if (lay) {
    node.layout = lay.layout;
    node.itemSpacing = lay.itemSpacing;
    node.paddingTop = lay.padding.t;
    node.paddingRight = lay.padding.r;
    node.paddingBottom = lay.padding.b;
    node.paddingLeft = lay.padding.l;
    node.primaryAxisAlign = lay.primary;
    node.counterAxisAlign = lay.counter;
    if (lay.layout === 'GRID') {
      node.gridColumns = lay.gridColumns;
      node.gridColumnGap = lay.gridColumnGap;
      node.gridRowGap = lay.gridRowGap;
      if (lay.gridCols && lay.gridCols.length === lay.gridColumns) {
        node.gridColumnSizes = lay.gridCols;
      }
    }
  }
  const isGrid = lay?.layout === 'GRID';
  // flex-wrap only matters when the in-flow children really broke onto a second line
  // (a second column for a column flexbox).
  let wrapped = false;
  if (lay && lay.wrapCss && lay.layout !== 'GRID') {
    const horizontal = lay.layout === 'HORIZONTAL';
    let prev: DOMRect | undefined;
    for (const c of Array.from(el.children)) {
      const ccs = win.getComputedStyle(c);
      if (isHidden(ccs) || ccs.position === 'absolute' || ccs.position === 'fixed') continue;
      const r = c.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      if (prev && (horizontal ? r.top >= prev.bottom - 1 : r.left >= prev.right - 1)) {
        wrapped = true;
        break;
      }
      prev = r;
    }
    if (wrapped) {
      node.wrap = true;
      node.counterAxisSpacing = lay.crossGap ?? 0;
      if (lay.alignContentBetween) node.counterAxisAlignContent = 'SPACE_BETWEEN';
    }
  }
  let looseGridText = false;
  // For a vertical Auto Layout, a child as wide as the content box should fill width.
  // (Not in a wrapped column: its children sit side by side in several columns.)
  const isVertical = lay?.layout === 'VERTICAL' && !wrapped;
  const contentWidth = isVertical ? rect.width - lay!.padding.l - lay!.padding.r : 0;
  // Left/right edges of the container's content box, in viewport coords.
  const contentLeft = rect.left + (lay ? lay.padding.l : 0);
  const contentRight = rect.right - (lay ? lay.padding.r : 0);

  const flowChildren: Array<{ rect: DOMRect; child: DesignTreeNode }> = [];

  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 1) {
      const childEl = child as Element;
      const childCs = win.getComputedStyle(childEl);
      if (isHidden(childCs)) continue;
      const cr = childEl.getBoundingClientRect();
      if (cr.width <= 0 || cr.height <= 0) continue;
      const childNode = buildNode(childEl, win, rect);
      const pos = childCs.position;
      if (pos === 'absolute' || pos === 'fixed') {
        // Out of flow in CSS → out of flow in Figma, at its measured x/y, whatever
        // its document position among flex siblings.
        childNode.absolute = true;
      } else if (isGrid) {
        // grid cells flow into Figma's grid; never pin or stretch them
      } else if (contentWidth > 0 && cr.width >= contentWidth - 2) {
        childNode.stretch = true;
      } else if (isVertical) {
        // Auto Layout ignores child margins, so a column child inset on BOTH sides
        // (e.g. a CTA with `margin: 0 28px`) would snap to the container edge.
        // Pin it absolutely to keep its measured position — unless the column itself
        // centers children (align-items: center), which Auto Layout reproduces.
        const leftInset = cr.left - contentLeft;
        const rightInset = contentRight - cr.right;
        const centered = lay!.counter === 'CENTER' && Math.abs(leftInset - rightInset) <= 1.5;
        if (leftInset > 1.5 && rightInset > 1.5 && !centered) {
          childNode.absolute = true;
        }
      }
      if (parseFloat(childCs.flexGrow) > 0) {
        childNode.grow = true;
      }
      node.children.push(childNode);
      if (!childNode.absolute && !childNode.stretch) {
        flowChildren.push({ rect: cr, child: childNode });
      }
    } else if (child.nodeType === 3) {
      const raw = (child.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (!raw) continue;
      const range = el.ownerDocument.createRange();
      range.selectNodeContents(child);
      const tr = range.getBoundingClientRect();
      if (tr.width <= 0 || tr.height <= 0) continue;
      if (isGrid) looseGridText = true; // an anonymous grid item: leave placement to auto-flow
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
      // Same rule as buildInlineTextNode: wrapped text takes the parent's content width.
      const padL = px(cs.paddingLeft);
      const contentW = rect.width - padL - px(cs.paddingRight);
      node.children.push({
        kind: 'text',
        x: multiline && contentW > tr.width ? padL : tr.left - rect.left,
        y: tr.top - rect.top,
        width: multiline ? Math.max(tr.width, contentW) : tr.width,
        height: tr.height,
        text,
        fontSize: px(cs.fontSize),
        fontWeight: fontWeightToNumber(cs.fontWeight),
        textColor: cs.color,
        textAlign: cssAlignToFigma(cs.textAlign),
        letterSpacing,
        lineHeight,
        multiline,
        textWrap: textWrapFrom(cs),
        fontVariation: fontVariationFrom(cs),
        children: []
      });
    }
  }

  if (lay && lay.layout !== 'GRID' && !wrapped) {
    // (A wrapped flexbox looks like one big negative gap at every line break; skip it.)
    applyOverlap(node, lay.layout, flowChildren);
  }
  if (lay && isGrid && !looseGridText) {
    const origin = {
      left: rect.left + px(cs.borderLeftWidth) + lay.padding.l,
      top: rect.top + px(cs.borderTopWidth) + lay.padding.t
    };
    if (placeGridChildren(lay, origin, flowChildren) && lay.gridRows) {
      node.gridManual = true;
      node.gridRowSizes = lay.gridRows;
    }
  }
  const only = node.children.length === 1 ? node.children[0] : undefined;
  if (!lay && only?.kind === 'text' && only.multiline) {
    growWithText(node, cs);
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
      name: doc.title.trim() || undefined,
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
