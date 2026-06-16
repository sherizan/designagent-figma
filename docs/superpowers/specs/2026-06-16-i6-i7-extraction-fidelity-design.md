# I6 + I7 — extraction fidelity (fill/stroke hex; spacing inference) — design

**Date:** 2026-06-16
**Status:** Approved (brainstorming) → ready for implementation plan
**Source:** `docs/DESIGNAGENT-EVALUATION.md` issues I6 (MEDIUM) + I7 (LOW–MEDIUM); remediation roadmap.
**Touches:** `src/core/types.ts`, `src/core/extract.ts`, `src/core/designdoc.ts`.

## Problem

**I6 — `get_spec`/`get_design_md` expose no fill/stroke colors.** `VisualSummary` (`types.ts:21`)
stores fills/strokes only as **type strings** (`'solid'`/`'mixed'`/`'gradient'`/…). On the logo
selection, `get_spec` reported fills as `'mixed'`/`'unknown'` with **no color values**, and
`get_design_md` extracted only `surface: #ffffff` — the brand pink (`#EC4D97`) and charcoal were
missed (the vector reported `fills: 'mixed'`, and DESIGN.md colors come only from `node.css` via
`gatherColorHits` (`designdoc.ts:106`), which didn't carry the vector's paint colors). This undercuts
the core "extract design tokens" value.

**I7 — spacing inference treats layout artifacts as a scale.** `collectSpacing` (`designdoc.ts:320`)
pools every `itemSpacing`/padding value with no frequency gate; `buildScale` (`:313`) then names the
first few unique values. So a logo frame's one-off gap/padding became
`spacing: { xs:10, sm:208, md:260, lg:344 }` — not a deliberate scale.

## Goal

`get_spec` exposes concrete fill/stroke hex; `get_design_md` captures real fill colors (including
vector/`mixed` fills the CSS path misses); the spacing scale reflects only repeated values, not
one-off layout artifacts.

## Non-goals
- Resolving image-fill colors, or per-stop gradient *positions* (gradient stop **colors** only).
- Confidence labels on tokens (chosen: drop one-offs, don't annotate).
- Frequency-gating the corner-radius scale (the eval flagged spacing only; radius left as-is).
- Reworking the existing CSS-based color/typography gathering beyond adding the paint-color source.

## Design

### I6.1 — color fields on `VisualSummary` (`src/core/types.ts`)
Add two optional fields (keep the existing type-string fields for back-compat):
```ts
  fillColors?: string[];   // concrete hex of solid fills / gradient stops (visible, non-transparent)
  strokeColor?: string;    // hex of a solid stroke
```

### I6.2 — extract concrete hexes (`src/core/extract.ts`)
- Add a small helper `paintHexes(paints): string[]` that, for a visible paint array, returns
  `#rrggbb` strings: `SOLID` → its color; `GRADIENT_*` → each gradient stop color; `IMAGE` → none.
  Reuse the existing `rgbToHex` (`:531`) but emit a **clean 6-digit `#rrggbb`** (no `(alpha …)`
  suffix — DESIGN.md/`parseColor` consume plain hex); skip fully transparent paints
  (`opacity === 0` / `color.a === 0`).
- At the `node.visual` build site (`:383-384`), set `fillColors = paintHexes(node.fills)` (when not
  mixed-the-whole-array / when paints are readable) and `strokeColor = paintHexes(node.strokes)[0]`.
  These populate even when the type string is `'mixed'` (so a mixed vector still yields its colors).
  Leave `fillColors` undefined when there are none (image-only / unreadable).

### I6.3 — feed paint colors into DESIGN.md (`src/core/designdoc.ts`)
In `gatherColorHits` (`:106`), in addition to the `node.css` colors, ingest
`node.visual?.fillColors` (as surface/background-type hits) and `node.visual?.strokeColor` (border
hit) through the same `parseColor`/hit pipeline. This makes the brand colors on a vector/`mixed`
logo show up in the DESIGN.md `colors` frontmatter.

### I7 — frequency-gate spacing (`src/core/designdoc.ts`)
Change `collectSpacing` to **count occurrences** of each spacing value across the selection and
return only values seen **≥2×** (de-duplicated; one-offs dropped). `buildScale` is unchanged and
receives the gated values. If the gate leaves nothing, the spacing scale is empty (no spurious
tokens) — acceptable. The corner-radius `buildScale` path is untouched.

## Edge cases
- All spacing values unique (count 1) → empty spacing scale (correct: no real scale).
- A fill paint with `figma.mixed` for `.color` or unreadable → `paintHexes` skips it (no throw).
- Near/fully transparent fills → skipped (not meaningful color tokens).
- `paintHexes` must never throw out of extraction.

## Verification
- `npm run typecheck` + root build + `claude-plugin/mcp` build clean (no MCP-tool change; rebuild for
  safety — `get_spec`/`get_design_md` return the new data through the unchanged tools).
- Live (Figma + bridge):
  - Select a shape/vector with a solid brand fill → `get_spec` `visual.fillColors` includes its hex
    (e.g. `#EC4D97`); a bordered node → `visual.strokeColor` is the border hex.
  - `get_design_md` on a selection with vector brand colors → the `colors` frontmatter includes the
    brand pink + charcoal (not just `surface: #ffffff`).
  - `get_design_md` on the logo-style selection → spacing scale no longer contains the one-off
    `208/260/344px` layout artifacts (only values repeated ≥2×, or empty).
- Bump all four version strings to `0.14.12`.

## Open questions
None — design approved 2026-06-16.
