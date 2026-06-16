# I1 — html_to_design flex exact-fit child drop — design

**Date:** 2026-06-16
**Status:** Approved (brainstorming) → ready for implementation plan
**Source:** `docs/DESIGNAGENT-EVALUATION.md` issue I1 (HIGH); remediation roadmap (Phase 2).
**Touches:** `src/ui_html.ts`, `src/shared/designtree.ts`, `src/code.ts`.

## Problem

A horizontal flex row whose children fill the row exactly (via `flex:1`, `width:fit-content`, or
`space-between` content-sized children) **silently drops or overlaps its last child**. Observed live:
feature cards (`flex:1` — middle card vanished), the stats row (`flex:1` — "2.3M" vanished + reordered),
4×272px semantic cards at exactly 1136px inner width (Info card dropped, its color bled into the
Warning slot), nav links/tabs, footer columns.

**Mechanism (confirmed in code):** the renderer rebuilds a flex row as Figma Auto Layout with each
child at its **measured pixel width as FIXED** and the parent width **FIXED**
(`buildFrameShell` sets `primaryAxisSizingMode = 'FIXED'`). The stretch/`contentWidth` logic at
`ui_html.ts:222` only runs for **VERTICAL** parents (`isVertical ? … : 0`), so horizontal children
never stretch and **`flex-grow` is never read**. At exact fit, sub-pixel rounding makes
`Σ(child widths) + gaps + padding` marginally exceed the FIXED parent → Figma mis-flows/drops the
last child. Worst with `flex:1` rows (every child is a content-measured FIXED width; nothing grows to
absorb slack).

## Goal

Horizontal flex rows reproduce faithfully and **never silently drop/overlap a child** — `flex:1`
distributes, content rows fit exactly, `space-between` rows stay full-width; a genuinely-overflowing
row overflows *visibly* rather than dropping a child.

## Non-goals
- Main-axis `flex-grow` distribution math beyond Figma's native `layoutGrow` (we let Figma distribute).
- `flex-wrap` / multi-line flex (out — rows are single-line).
- `flex-shrink`/`flex-basis` fidelity, min/max-width constraints. Out.
- Other eval items (I6/I7 extraction, I4 spans, I5 margins) — separate.

## Design

Four changes; the renderer reads `flex-grow`, the sandbox uses Figma's native flex sizing.

### 1. Capture `flex-grow` (`src/ui_html.ts` + `src/shared/designtree.ts`)
- Add `grow?: boolean;` to `DesignTreeNode`.
- In `buildNode`'s child loop, set `childNode.grow = true` when
  `parseFloat(childCs.flexGrow) > 0`. (`flex-grow` is the main-axis grow factor — orientation-agnostic;
  it's `0` for non-flex children, so this is safe to read unconditionally.)

### 2. Parent primary-axis sizing — hug unless it needs a fixed width (`buildFrameShell`)
Today: `frame.primaryAxisSizingMode = 'FIXED'` for every auto-layout frame. Change to:
```
const needsFixedMain = node.children.some((c) => c.grow) || node.primaryAxisAlign === 'SPACE_BETWEEN';
frame.primaryAxisSizingMode = needsFixedMain ? 'FIXED' : 'AUTO';
frame.counterAxisSizingMode = 'FIXED';
```
- **Hug (`AUTO`)** for content-packed rows (MIN/CENTER/MAX, no grow): the frame sizes to exactly
  `children + gaps + padding` — there is no FIXED width to overflow, so the exact-fit drop is
  structurally impossible.
- **`FIXED`** when a child grows (grow children need the parent width to distribute into) or when
  `SPACE_BETWEEN` (needs full width to distribute). The clamp (below) keeps these from dropping.
- Counter-axis stays `FIXED` (measured height). This applies to both orientations; the existing
  vertical-stretch (counter-axis fill) logic in `buildNode` is unchanged.

### 3. Grow children fill (`appendDesignChildren`)
For each built child, when `child.grow`, set `created.layoutGrow = 1` (guard `'layoutGrow' in created`).
Figma distributes the row's main-axis space across grow children — honoring `flex:1` equal
distribution — and **never drops or wraps a grow child** (it shrinks/expands them to fit). Coexists
with the existing `absolute`/`stretch` (counter-axis) handling.

### 4. Clamp — never silently drop (`buildFrameShell`)
For `FIXED`-main rows, ensure the frame's main-axis size is at least the space its non-grow children
need:
```
width (HORIZONTAL) = max(node.width, Σ fixed(non-grow) child widths + Σ gaps + paddingLeft + paddingRight)
```
(analogously height for a VERTICAL FIXED row). If a design genuinely doesn't fit, the row **overflows
visibly** instead of dropping a child. For the common case the measured width already satisfies this,
so the clamp is a no-op; it only ever grows the frame, never shrinks.

## Edge cases
- A grow row where fixed children + gaps already meet/exceed the measured width → grow children get
  ~0 and fixed children still fit (clamp guarantees it); visible, no drop.
- Single-child flex / `kids.length < 2` block → unchanged (no row to mis-flow).
- `space-around`/`space-evenly` (Figma has no exact equivalent; `primaryFromJustify` maps them) — if
  mapped to `SPACE_BETWEEN` they take the FIXED+clamp path; if mapped to MIN they hug. Either is
  drop-free.
- Must never throw out of `buildFrameShell`/`appendDesignChildren` (the render continues).

## Verification
- `npm run typecheck` + root build clean (`claude-plugin/mcp` unaffected; rebuild for safety).
- Live (Figma + bridge), render and `take_screenshot`:
  - 4 fixed cards summing to ~container width (e.g. `display:flex; gap:16px` with 4×272 in 1136) →
    **all four present**, none dropped, colors in their own slots.
  - `flex:1` feature-card row (3 cards) → middle card present; equal widths.
  - `flex:1` stats row → all stats present, in source order.
  - `justify-content:space-between` nav → links spread full-width, none dropped.
  - A row authored to genuinely overflow → it overflows visibly (no missing child).
- Bump all four version strings to `0.14.11`.

## Open questions
None — design approved 2026-06-16.
