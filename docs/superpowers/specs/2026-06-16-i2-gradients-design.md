# I2 — html_to_design CSS gradient rendering — design

**Date:** 2026-06-16
**Status:** Approved (brainstorming) → ready for implementation plan
**Source:** `docs/DESIGNAGENT-EVALUATION.md` issue I2 (HIGH); remediation roadmap (Phase 2).
**Touches:** `src/ui_html.ts`, `src/shared/designtree.ts`, `src/code.ts`.

## Problem

CSS gradient backgrounds render as a **near-white solid** — silently. `src/ui_html.ts` reads only
`cs.backgroundColor` (`applyBoxStyles`, ~`:144`), never `backgroundImage` (which holds
`linear-gradient(...)`/`radial-gradient(...)`). And `src/code.ts` has no gradient paint path —
`cssSolidPaint`/`parseCssColor` only handle solids — so a gradient element gets the default
near-white fill. Observed live: a `linear-gradient(135deg,#2A2A2E,#18181B)` CTA band rendered white
(hiding white headline text); `linear-gradient(150deg,#EC4D97,#B02868)` rendered pale.

## Goal

`linear-gradient` paints as a real Figma `GRADIENT_LINEAR` (correct angle + all color stops).
`radial-gradient` / `conic-gradient` / any unparseable gradient **flattens to the first color stop**
(never white) and logs a `console.warn` so the lost fidelity is visible (via `console_logs`).

## Non-goals
- Real `radial-gradient`/`conic-gradient` paints (flatten-to-first-stop is the chosen scope; can
  upgrade radial → `GRADIENT_RADIAL` later).
- `background-clip: text` gradient text, multiple stacked backgrounds, gradient borders. Out.
- Other render-fidelity issues (I1 flex, I4 spans, I5 margins) — separate.

## Design

The gradient travels as a **raw CSS string** carried on the tree node and parsed sandbox-side —
exactly how `fill` (a CSS color string) already works.

### 1. Capture the gradient string (`src/ui_html.ts`)
In `applyBoxStyles`, in addition to `cs.backgroundColor`, read `cs.backgroundImage`. If it contains
a gradient function (`/gradient\(/i`), set `node.gradient = <the backgroundImage string>`. Keep
setting `node.fill` from `backgroundColor` as the last-resort fallback (it's usually transparent when
a gradient is present, which is fine).

### 2. Carry it on the tree (`src/shared/designtree.ts`)
Add `gradient?: string;` to `DesignTreeNode` (raw CSS gradient string, parsed on the sandbox side).

### 3. Parse + paint (`src/code.ts`)
Add, near `cssSolidPaint` (`:1241`) / `parseCssColor` (`:1214`):
- **`cssGradientPaint(input: string): GradientPaint | null`** — parses **`linear-gradient`** only:
  - **Direction:** `<number>deg` | `to <side>`/`to <corner>` (map: to top=0°, to right=90°, to
    bottom=180°, to left=270°; corners → the corner angle) | default `to bottom` (180°). Convert the
    CSS angle (0° = upward, clockwise) into a Figma `gradientTransform` rotation matrix (Figma's
    default gradient runs along local +X). **Exact matrix formula is derived in the implementation
    plan.**
  - **Stops:** split the comma-separated list after the direction; each is `color [position%]`. Parse
    color via the existing `parseCssColor`; positions explicit (`%`) or evenly distributed across
    `[0,1]`. Build `gradientStops: [{ position, color: { r, g, b, a } }]`.
  - Returns `{ type: 'GRADIENT_LINEAR', gradientTransform, gradientStops }`, or `null` if it isn't a
    linear gradient or fails to parse.
- **`firstGradientStopColor(input: string): string | null`** — returns the first parseable color
  substring from any gradient string (for the flatten fallback).

### 4. Apply (`buildFrameShell` in `src/code.ts`)
Gradients are backgrounds, so only the frame path needs this. Where `buildFrameShell` currently does
`const fill = cssSolidPaint(node.fill); frame.fills = fill ? [fill] : [];`, replace with a single
fill resolution:
1. If `node.gradient`: try `cssGradientPaint(node.gradient)` → if non-null, use it.
2. Else flatten: `cssSolidPaint(firstGradientStopColor(node.gradient))` and
   `console.warn('html_to_design: gradient flattened (unsupported/unparseable):', node.gradient)`.
3. Else (no gradient): existing `cssSolidPaint(node.fill)`.
4. If everything yields null: `frame.fills = []` (current behavior).

## Error handling
- Unparseable/radial/conic → flatten to first stop (never white) + `console.warn`.
- Flatten color also unparseable → fall back to `node.fill` solid, else `[]`.
- A malformed gradient string must never throw out of `buildFrameShell` (the render must continue).

## Verification
- `npm run typecheck` + root build + `claude-plugin/mcp` build (no MCP change expected, but rebuild
  for safety) clean.
- Live (Figma + bridge), render the eval's exact repros:
  - `<div style="background: linear-gradient(135deg,#2A2A2E,#18181B)">` → a real dark diagonal
    gradient (white text on it is legible), NOT white.
  - `linear-gradient(150deg,#EC4D97,#B02868)` → the pink→magenta gradient at the right angle.
  - `radial-gradient(...)` → a flat first-stop color (not white) + a `console_logs` warning.
  - A vertical default `linear-gradient(#fff,#000)` (no angle) → top-white→bottom-black.
  - `take_screenshot` confirms each.
- Bump all four version strings to `0.14.10`.

## Open questions
None — design approved 2026-06-16.
