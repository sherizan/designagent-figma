# I4 + I5 — inline styled text & negative-margin overlap — design

**Date:** 2026-06-17
**Status:** Approved (brainstorming) → ready for implementation plan
**Source:** `docs/DESIGNAGENT-EVALUATION.md` issues I4 (MEDIUM) + I5 (LOW–MEDIUM); the final eval items.
**Touches:** `src/shared/designtree.ts`, `src/ui_html.ts`, `src/core/code.ts` (`src/code.ts`).

## Problem

**I4 — inline styled `<span>` inside wrapping text overlaps.** In `buildNode`'s child loop
(`ui_html.ts:227-250`), an inline `<span>` (element, `nodeType===1`) is built as a **separate frame**
(`:234`) while the surrounding text fragments become **separate text nodes** (`:251`). For
`From idea to <span class="accent">prototype</span>, in minutes.` that's three disconnected nodes;
on a wrapping heading their `Range` bounding rects overlap → the accent renders mispositioned over the
rest.

**I5 — negative margins scramble.** Children with `margin-left:-12px` (an overlapping avatar stack)
overlap on the main axis, but the row is rebuilt as Figma Auto Layout with `itemSpacing` from CSS
`gap` (`0`) — the overlap is lost and items shift/reorder. Margins are never read.

## Goal

Inline styled spans render as one continuous, correctly-styled text node (accent color/weight
preserved inline, no overlap); overlapping children (negative margins) keep their visual overlap.

## Non-goals
- Per-range font-size / letter-spacing / line-height inside a text run (only **color + weight**).
- Nested inline markup beyond one level (e.g. `<b><i>x</i></b>`) — falls back to today's behavior.
- `flex-wrap` multi-line flex; `flex-shrink`/`basis`. Out.
- Block-level children inside a text block (those keep today's per-child handling).

## Design

### I4 — merge inline text into one text node with style runs

**Tree contract (`src/shared/designtree.ts`):**
```ts
export interface TextRun {
  start: number;          // char offset into the combined string (inclusive)
  end: number;            // exclusive
  color?: string;         // CSS color for this range (overrides base)
  fontWeight?: number;
}
```
Add `runs?: TextRun[];` to `DesignTreeNode` (alongside the existing text fields).

**Renderer (`src/ui_html.ts`):**
- `isInlineTextContainer(el, cs, win)` → true when: `computeLayout(el,…)` is null (not a flex/stack
  container), the element has **mixed** content (≥1 text node child **and** ≥1 element child), and
  **every element child is inline-level** (`display` `inline`/`inline-block`) **with only text inside**
  (no grandchild elements). Anything else → false (existing per-child path, unchanged).
- When true, in `buildNode` emit **one** `kind:'text'` node instead of the per-child loop:
  - **Combined string:** concatenate child text in document order; collapse runs of whitespace to a
    single space across the whole string; do not trim interior spaces (preserves "to ", " ,"). Apply
    the element's `text-transform` to the whole string.
  - **Runs:** as each child's text is appended, record its `[start,end)` range; for an inline
    **element** child, set `color`/`fontWeight` from that child's computed style **only when they
    differ from the container's base** (skip redundant runs). Plain text-node children inherit the
    base (no run needed).
  - Position/size = the element's measured rect; base `fontSize`/`textColor`/`fontWeight`/
    `lineHeight`/`letterSpacing`/`textAlign`/`multiline` from the element's own computed style (as the
    current text path does).

**Sandbox (`src/code.ts`, text branch of `buildDesignNode`):** after `characters` + base style are
set, for each run apply: `text.setRangeFills(start, end, [solidPaint(color)])` when `color` is set;
and when `fontWeight` is set, load that weight's font and `text.setRangeFontName(start, end, font)` —
reuse the existing weight/font-loading path (`applyTextWeight`/`loadFontForNewText`); wrap each range
op in try/catch so a missing weight/range just keeps the base (never throws).

### I5 — overlapping children → negative itemSpacing or absolute

**Renderer (`src/ui_html.ts`), after the child loop in `buildNode`** (only when `lay` is set, i.e. an
auto-layout parent): consider the **flow** children (not `absolute`/`stretch`), in order, ≥2 of them.
Compute consecutive main-axis gaps (HORIZONTAL → `next.left − cur.right`; VERTICAL → `next.top −
cur.bottom`) from their measured rects.
- If **all** gaps are negative and **uniform** (within ~1px of each other) → set
  `node.itemSpacing` to that (negative, rounded) gap. Figma renders overlapping auto-layout — the
  avatar stack stays an editable row.
- Else if **any** gap is negative (non-uniform overlap) → mark each flow child `absolute` (its measured
  x/y already on the node) so positions are preserved exactly.
- No overlap → unchanged.

**Sandbox:** negative `itemSpacing` already flows through (`frame.itemSpacing = node.itemSpacing`);
`absolute` is already handled (`layoutPositioning='ABSOLUTE'` + x/y). No new sandbox logic for I5.
Interactions: the I1 clamp uses `flowKids` and `itemSpacing` in its gap sum — a negative itemSpacing
just lowers the needed width (fine); absolute children are already excluded.

## Edge cases
- I4: a span whose color/weight equals the base → no run emitted. A weight the font family lacks →
  range keeps base (try/catch). Combined string empty → fall through to existing handling.
- I4 detection must be conservative: any block/flex child, or a flex container, → existing per-child
  path (don't merge), so normal layouts are unaffected.
- I5: needs ≥2 flow children; ignore sub-pixel gaps (`> -1px` is "no overlap"); a row that's already
  all-absolute is untouched.
- Neither path may throw out of `buildNode`/`buildDesignNode`.

## Verification
- `npm run typecheck` + root build clean (`claude-plugin/mcp` unaffected; rebuild for safety).
- Live (Figma + bridge), render + `take_screenshot`:
  - `<h1>From idea to <span style="color:#EC4D97;font-weight:700">prototype</span>, in minutes.</h1>`
    at a width that wraps → a single heading text node; "prototype" pink + bold inline; no overlap.
  - A heading with no spans → unchanged (single text node, as before).
  - An avatar row: 4 × 40px circles each `margin-left:-12px` (first `0`) → avatars overlap by 12px, in
    order, left-to-right.
  - A normal flex row (positive gap) → unchanged (I1 behavior intact).
- Bump all four version strings to `0.14.13`.

## Open questions
None — design approved 2026-06-17.
