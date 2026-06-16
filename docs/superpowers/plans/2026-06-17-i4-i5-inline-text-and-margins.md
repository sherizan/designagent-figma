# I4 + I5 — Inline Styled Text & Negative-Margin Overlap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inline styled `<span>`s render as one continuous text node with per-character color/weight runs (no overlap), and children with negative margins keep their visual overlap.

**Architecture:** Two independent fixes in the HTML→Figma path. **I4:** the renderer (`src/ui_html.ts`) detects a block whose content is text interleaved with inline, text-only elements and emits **one** `kind:'text'` node carrying a `runs[]` array (char ranges with color/weight); the sandbox (`src/code.ts`) applies each run with `setRangeFills`/`setRangeFontName`. **I5:** after building children, the renderer measures main-axis gaps between flow children — uniform overlap → negative `itemSpacing`; non-uniform overlap → mark children `absolute`. The sandbox already passes both through, so I5 is renderer-only.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), esbuild. No test framework — the verification gate is `npm run typecheck` + `npm run build`, plus live Figma render checks via the bridge `take_screenshot` at the end.

**Spec:** `docs/superpowers/specs/2026-06-17-i4-i5-inline-text-and-margins-design.md`

---

## Background the implementer needs

- **Two-process model:** `src/ui_html.ts` runs in the React UI iframe (real browser DOM, no Figma API). It walks a rendered HTML tree into a serializable `DesignTreeNode` (`src/shared/designtree.ts`). `src/code.ts` is the Figma sandbox (`figma.*`, no DOM) — it consumes `DesignTreeNode` and builds Figma nodes in `buildDesignNode`.
- **No tests, no `it()`/`pytest`.** Each task's "test" is: edit → `npm run typecheck` (must pass clean) → `npm run build` (must succeed). Live visual verification happens once at the end (Task 6) in Figma Desktop.
- **Never throw out of `buildNode` (renderer) or `buildDesignNode` (sandbox).** Wrap risky DOM/Figma calls in try/catch and degrade gracefully — a malformed run must keep the base style, not crash the render.
- **Existing helpers you will reuse (already in the files):**
  - `src/ui_html.ts`: `px()`, `isVisibleColor()`, `isHidden()`, `fontWeightToNumber()`, `cssAlignToFigma()`, `computeLayout()`.
  - `src/code.ts`: `cssSolidPaint()` (CSS color → `SolidPaint | null`), `loadFontForNewText()`, `applyTextWeight()`, `WEIGHT_ALIASES`.
- **`computeLayout(el, cs, win)`** returns a `LayoutInfo` for flex / clean vertical block stacks, else `null`. An inline-text heading (e.g. `<h1>` with one `<span>`) returns `null` (its only element children are inline, sharing a line — not a clean vertical stack). We only treat an element as an inline-text container when `computeLayout` is `null`.

---

## File Structure

- `src/shared/designtree.ts` — **Modify.** Add `TextRun` interface + `runs?: TextRun[]` on `DesignTreeNode`. The message contract between the two processes.
- `src/ui_html.ts` — **Modify.** Add `isInlineLevel()`, `isInlineTextContainer()`, `buildInlineTextNode()` (I4); add `applyOverlap()` called after the child loop in `buildNode` (I5).
- `src/code.ts` — **Modify.** Extract `resolveWeightFontName()` (shared by `applyTextWeight` + runs); apply `node.runs` in the text branch of `buildDesignNode`.
- `package.json`, `src/ui_components.tsx`, `claude-plugin/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` — **Modify.** Version bump to `0.14.13`.

---

## Task 1: TextRun contract on DesignTreeNode

**Files:**
- Modify: `src/shared/designtree.ts:14-52`

- [ ] **Step 1: Add the `TextRun` interface and the `runs` field**

In `src/shared/designtree.ts`, add the `TextRun` interface just above `export interface DesignTreeNode` (after the `DesignTreeShadow` interface, around line 12):

```ts
// A styled character range inside a merged inline-text node (I4). Offsets index
// into DesignTreeNode.text (the combined, whitespace-normalized string).
export interface TextRun {
  start: number; // inclusive char offset into the combined string
  end: number; // exclusive
  color?: string; // CSS color overriding the base text color for this range
  fontWeight?: number; // numeric weight overriding the base for this range
}
```

Then add the `runs` field inside `DesignTreeNode`, immediately after the `multiline?: boolean;` line (currently line 35):

```ts
  multiline?: boolean;
  runs?: TextRun[]; // per-character style runs for a merged inline-text node (I4)
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors — the new optional field and interface are unused so far).

- [ ] **Step 3: Commit**

```bash
git add src/shared/designtree.ts
git commit -m "feat(designtree): add TextRun + runs field for inline styled text (I4)"
```

---

## Task 2: Renderer — merge inline styled spans into one text node (I4)

**Files:**
- Modify: `src/ui_html.ts:1` (import), `src/ui_html.ts:80-87` (helpers area), `src/ui_html.ts:209-219` (buildNode, before the child loop)

- [ ] **Step 1: Import the `TextRun` type**

Change the import on line 1 of `src/ui_html.ts` from:

```ts
import type { DesignTreeNode, DesignTreeShadow } from './shared/designtree';
```

to:

```ts
import type { DesignTreeNode, DesignTreeShadow, TextRun } from './shared/designtree';
```

- [ ] **Step 2: Add detection + builder helpers**

Insert these three functions in `src/ui_html.ts` just before `function buildNode` (i.e. directly after the `buildNode` doc-comment block — paste them above the `function buildNode(el: Element, ...)` line, around line 173). They reuse the existing `isHidden`, `isVisibleColor`, `fontWeightToNumber`, `px`, `cssAlignToFigma` helpers:

```ts
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
```

- [ ] **Step 3: Branch to the merged node in `buildNode`**

In `buildNode`, the layout/children logic begins at line 209 with `const lay = computeLayout(el, cs, win);`. Insert the inline-text-container short-circuit immediately after that line (before `if (lay) {` on line 210):

```ts
  const lay = computeLayout(el, cs, win);
  if (!lay && isInlineTextContainer(el, win)) {
    const merged = buildInlineTextNode(el, cs, win, rect);
    if (merged) {
      node.children.push(merged);
      return node;
    }
  }
  if (lay) {
```

This makes `el` a frame containing one merged text child — identical structure to a plain heading (frame + one text node), so positioning is unchanged. If `buildInlineTextNode` returns null, it falls through to the existing per-child loop.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: succeeds, writes `dist/` (no errors).

- [ ] **Step 6: Commit**

```bash
git add src/ui_html.ts
git commit -m "feat(html): merge inline styled spans into one text node with runs (I4)"
```

---

## Task 3: Sandbox — apply style runs to the text node (I4)

**Files:**
- Modify: `src/code.ts:10` (import), `src/code.ts:952-996` (text branch), `src/code.ts:1578-1614` (`applyTextWeight` refactor)

- [ ] **Step 1: Import the `TextRun` type**

Change `src/code.ts` line 10 from:

```ts
import type { DesignTreeNode } from './shared/designtree';
```

to:

```ts
import type { DesignTreeNode, TextRun } from './shared/designtree';
```

- [ ] **Step 2: Extract `resolveWeightFontName` and have `applyTextWeight` use it**

Replace the entire `applyTextWeight` function (currently `src/code.ts:1578-1614`) with the following two functions. `resolveWeightFontName` is the existing resolution logic lifted out so it can be reused for ranges; it now **returns** the loaded `FontName` instead of assigning it:

```ts
// Resolve a requested weight (number like 600, or a style name like "Semi Bold")
// against the styles the node's font family actually ships, load it, and return
// the FontName. Throws if the family has no matching weight.
async function resolveWeightFontName(node: TextNode, weight: unknown): Promise<FontName> {
  const base =
    node.fontName === figma.mixed
      ? node.characters.length > 0
        ? node.getRangeFontName(0, 1)
        : { family: 'Inter', style: 'Regular' }
      : node.fontName;
  const family = base === figma.mixed ? 'Inter' : base.family;

  const raw = String(weight).trim();
  const candidates = /^\d+$/.test(raw)
    ? WEIGHT_ALIASES[raw] ?? ['Regular']
    : [raw, ...(WEIGHT_ALIASES[raw] ?? [])];

  const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, '');
  const fonts = await figma.listAvailableFontsAsync();
  const familyStyles = fonts
    .filter((f) => f.fontName.family === family)
    .map((f) => f.fontName.style);

  let match: string | undefined;
  for (const candidate of candidates) {
    match = familyStyles.find((style) => norm(style) === norm(candidate));
    if (match) {
      break;
    }
  }
  if (!match) {
    throw new Error(
      `Font "${family}" has no "${raw}" weight. Available: ${familyStyles.join(', ') || 'none'}.`
    );
  }

  const fontName = { family, style: match };
  await figma.loadFontAsync(fontName);
  return fontName;
}

// Apply a font weight to a whole text node.
async function applyTextWeight(node: TextNode, weight: unknown): Promise<void> {
  node.fontName = await resolveWeightFontName(node, weight);
}
```

- [ ] **Step 3: Add an `applyRuns` helper above `buildDesignNode`**

Insert this helper just before `async function buildDesignNode` (currently line 948). It clamps offsets, applies weight then color per run, and swallows per-run failures so a missing weight/bad range keeps the base style:

```ts
// Apply per-character style runs (I4) to an already-populated text node. Each run
// is best-effort: a missing weight or bad range keeps the base style, never throws.
async function applyRuns(text: TextNode, runs: TextRun[]): Promise<void> {
  const len = text.characters.length;
  for (const run of runs) {
    const start = Math.max(0, Math.min(Math.floor(run.start), len));
    const end = Math.max(start, Math.min(Math.floor(run.end), len));
    if (end <= start) continue;
    if (run.fontWeight) {
      try {
        const fontName = await resolveWeightFontName(text, run.fontWeight);
        text.setRangeFontName(start, end, fontName);
      } catch {
        // keep the base weight for this range
      }
    }
    if (run.color) {
      const paint = cssSolidPaint(run.color);
      if (paint) {
        try {
          text.setRangeFills(start, end, [paint]);
        } catch {
          // keep the base fill for this range
        }
      }
    }
  }
}
```

- [ ] **Step 4: Call `applyRuns` in the text branch**

In `buildDesignNode`, the text branch sets base styles then returns at line 993-995 (`text.x = node.x; text.y = node.y; return text;`). Insert the run application immediately before `text.x = node.x;`:

```ts
    if (node.runs && node.runs.length > 0) {
      await applyRuns(text, node.runs);
    }
    text.x = node.x;
    text.y = node.y;
    return text;
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: succeeds, writes `dist/code.js` (no errors).

- [ ] **Step 7: Commit**

```bash
git add src/code.ts
git commit -m "feat(sandbox): apply per-range color/weight runs to text nodes (I4)"
```

---

## Task 4: Renderer — preserve overlapping children (I5)

**Files:**
- Modify: `src/ui_html.ts` (add `applyOverlap` helper near `computeLayout`, ~line 141; call it at the end of `buildNode`, after the child loop closes at line 289)

- [ ] **Step 1: Add the `applyOverlap` helper**

Insert this function in `src/ui_html.ts` after `computeLayout` (i.e. after its closing brace on line 141, before `function applyBoxStyles`). It reads the measured rects of the **flow** children (those not already marked `absolute`/`stretch`) and decides between negative `itemSpacing` (uniform overlap) and `absolute` positioning (non-uniform overlap):

```ts
// Detect overlapping children (negative margins) and preserve the overlap:
// uniform overlap → a single negative itemSpacing (stays an editable Auto Layout
// row); non-uniform overlap → pin each flow child absolutely at its measured x/y.
// `flowEls` are the element children that were emitted as flow nodes, paired with
// the DesignTreeNode pushed for each, in document order.
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
  if (!gaps.every((g) => g < -1)) return; // need every consecutive pair to overlap
  const min = Math.min(...gaps);
  const max = Math.max(...gaps);
  if (max - min <= 1) {
    node.itemSpacing = Math.round((min + max) / 2);
  } else {
    for (const f of flow) {
      f.child.absolute = true;
    }
  }
}
```

- [ ] **Step 2: Collect flow children during the loop and call `applyOverlap`**

In `buildNode`, the child loop runs from line 227 (`for (const child of Array.from(el.childNodes)) {`) to line 289. We need to remember each flow child's rect alongside its node. Make two edits:

(a) Declare a collector immediately before the loop (right after line 225, `const contentRight = ...`):

```ts
  const flowChildren: Array<{ rect: DOMRect; child: DesignTreeNode }> = [];
```

(b) Inside the element branch, the existing code pushes `childNode` at line 250 (`node.children.push(childNode);`). Replace that single line with a push to both arrays, recording the rect (`cr`, already computed at line 232) only for flow children:

```ts
      node.children.push(childNode);
      if (!childNode.absolute && !childNode.stretch) {
        flowChildren.push({ rect: cr, child: childNode });
      }
```

(c) After the child loop's closing brace (line 289) and before `return node;` (line 291), call `applyOverlap` when this is an Auto Layout parent:

```ts
  if (lay) {
    applyOverlap(node, lay.layout, flowChildren);
  }

  return node;
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: succeeds (no errors).

- [ ] **Step 5: Commit**

```bash
git add src/ui_html.ts
git commit -m "feat(html): preserve overlapping children via negative itemSpacing / absolute (I5)"
```

---

## Task 5: Version bump to 0.14.13

**Files:**
- Modify: `package.json:3`, `src/ui_components.tsx:508`, `claude-plugin/.claude-plugin/plugin.json:3`, `.claude-plugin/marketplace.json:16`

Per the four-string versioning policy (CLAUDE.md): bump all four together, leave `marketplace.json` top-level `metadata.version` (`0.1.0`) alone.

- [ ] **Step 1: Bump `package.json`**

`src/`… change line 3 of `package.json` from `"version": "0.14.12",` to `"version": "0.14.13",`.

- [ ] **Step 2: Bump the UI footer tag**

In `src/ui_components.tsx:508`, change `<span className="version-tag">v1.14.12</span>` to `<span className="version-tag">v1.14.13</span>`.

- [ ] **Step 3: Bump the Claude plugin bundle**

In `claude-plugin/.claude-plugin/plugin.json:3`, change `"version": "0.14.12",` to `"version": "0.14.13",`.

- [ ] **Step 4: Bump the marketplace entry**

In `.claude-plugin/marketplace.json:16` (the `plugins[0].version`), change `"version": "0.14.12",` to `"version": "0.14.13",`. Leave line 9 (`metadata.version: "0.1.0"`) unchanged.

- [ ] **Step 5: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json src/ui_components.tsx claude-plugin/.claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "chore: bump versions to 0.14.13 (I4 inline runs + I5 overlap)"
```

---

## Task 6: Live verification in Figma (manual, via the bridge)

**No code.** Re-run the DesignAgent dev plugin in Figma (Plugins → Development → DesignAgent) so it loads the fresh `dist/` build, confirm the bridge dot is green, then use the `designagent` MCP tools to render the spec's repros and screenshot them.

- [ ] **Step 1: I4 — inline colored + bold word, wrapped**

`html_to_design` with:

```html
<div style="width:280px;font-family:Inter;font-size:40px;font-weight:600;color:#1a1a1a;line-height:1.1;padding:24px">From idea to <span style="color:#EC4D97;font-weight:700">prototype</span>, in minutes.</div>
```

Then `take_screenshot`. Expected: the heading is **one** text node; "prototype" is pink and bold inline; the words flow on wrapped lines with **no overlap** and correct order.

- [ ] **Step 2: I4 regression — plain heading unchanged**

`html_to_design` with `<h1 style="font-family:Inter;font-size:40px">Just a heading</h1>`, `take_screenshot`. Expected: a single heading text node, exactly as before (no behavior change for span-free text).

- [ ] **Step 3: I5 — overlapping avatar stack**

`html_to_design` with:

```html
<div style="display:flex;padding:20px;background:#fff">
  <div style="width:40px;height:40px;border-radius:20px;background:#EC4D97"></div>
  <div style="width:40px;height:40px;border-radius:20px;background:#6B5BFF;margin-left:-12px"></div>
  <div style="width:40px;height:40px;border-radius:20px;background:#1a1a1a;margin-left:-12px"></div>
  <div style="width:40px;height:40px;border-radius:20px;background:#FFB020;margin-left:-12px"></div>
</div>
```

Then `take_screenshot`. Expected: four circles **overlapping by ~12px, in left-to-right order** (pink under purple under charcoal under amber), not spread apart or reordered.

- [ ] **Step 4: I5 regression — normal flex row unchanged**

`html_to_design` with a `display:flex;gap:16px` row of three boxes, `take_screenshot`. Expected: positive 16px gaps preserved (I1 behavior intact, no overlap logic triggered).

- [ ] **Step 5: Report**

Summarize the four screenshots against expectations. If any repro is wrong, capture the `console_logs` and fix before finishing the branch.

---

## Self-Review

**1. Spec coverage:**
- I4 tree contract (`TextRun` + `runs`) → Task 1. ✓
- I4 `isInlineTextContainer` detection (computeLayout null + mixed text/inline + every element child inline-with-only-text) → Task 2 Step 2/3. ✓
- I4 combined whitespace-normalized string with run offsets + text-transform → Task 2 `buildInlineTextNode` (`appendNormalized`). ✓
- I4 runs only when color/weight differ from base → Task 2 (`run.color`/`run.fontWeight` guarded). ✓
- I4 sandbox `setRangeFills`/`setRangeFontName` reusing the weight/font path, try/catch → Task 3 (`applyRuns` + extracted `resolveWeightFontName`). ✓
- I5 uniform negative gap → negative `itemSpacing`; non-uniform → `absolute` → Task 4 `applyOverlap`. ✓
- I5 no new sandbox logic (already flows through) → confirmed in spec; Task 4 is renderer-only. ✓
- Edge cases (span equal to base → no run; missing weight → base via try/catch; empty combined → fall through; ≥2 flow children; sub-pixel gaps ignored) → covered in Task 2/3/4 code. ✓
- Version bump to 0.14.13 → Task 5. ✓
- Verification (typecheck/build + live repros) → per-task gates + Task 6. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**3. Type consistency:** `TextRun { start, end, color?, fontWeight? }` defined in Task 1, imported and used identically in Task 2 (renderer builds it) and Task 3 (`applyRuns(text, runs: TextRun[])`). `resolveWeightFontName(node, weight): Promise<FontName>` defined and used in Task 3 by both `applyTextWeight` and `applyRuns`. `applyOverlap(node, layout, flow)` signature matches its single call site. `flowChildren: Array<{ rect: DOMRect; child: DesignTreeNode }>` matches `applyOverlap`'s `flow` param. ✓
