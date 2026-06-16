# I6 + I7 — Extraction Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `get_spec` exposes concrete fill/stroke hex; `get_design_md` captures real fill colors (incl. vector/`mixed` fills the CSS path misses); the spacing scale drops one-off layout artifacts.

**Architecture:** `extract.ts` reads paint colors into `VisualSummary.fillColors`/`strokeColor`; `designdoc.ts` ingests those into its color gathering and frequency-gates the spacing scale.

**Tech Stack:** TypeScript; Figma Plugin API (`Paint`/`GradientPaint`/`RGB`/`RGBA`) in `src/core/extract.ts`; pure functions in `src/core/designdoc.ts`. Build: `npm run build` (root). No unit-test framework — verify via `npm run typecheck` + build per task and a manual `get_spec`/`get_design_md` bridge check (Task 3). No MCP-tool change.

**Spec:** `docs/superpowers/specs/2026-06-16-i6-i7-extraction-fidelity-design.md`

---

### Task 1: Emit fill/stroke hex (I6.1 + I6.2)

**Files:**
- Modify: `src/core/types.ts` (`VisualSummary`)
- Modify: `src/core/extract.ts` (new `solidHex`/`paintHexes`; `extractVisualSummary` `:382-387`)

- [ ] **Step 1: Add color fields to `VisualSummary`.** In `src/core/types.ts`, the interface is:

```ts
export interface VisualSummary {
  fills: 'none' | 'solid' | 'gradient' | 'image' | 'mixed' | 'unknown';
  strokes: 'none' | 'solid' | 'mixed' | 'unknown';
  cornerRadius: number | 'mixed' | 'undefined';
  effects: 'none' | 'shadow' | 'blur' | 'mixed';
}
```

Add two optional fields:

```ts
export interface VisualSummary {
  fills: 'none' | 'solid' | 'gradient' | 'image' | 'mixed' | 'unknown';
  fillColors?: string[];
  strokes: 'none' | 'solid' | 'mixed' | 'unknown';
  strokeColor?: string;
  cornerRadius: number | 'mixed' | 'undefined';
  effects: 'none' | 'shadow' | 'blur' | 'mixed';
}
```

- [ ] **Step 2: Add `solidHex` + `paintHexes` helpers.** In `src/core/extract.ts`, immediately after `summarizeStrokes` (ends `:80`), add:

```ts
// Plain #rrggbb (no alpha suffix) — DESIGN.md / parseColor consume clean hex.
function solidHex(color: RGB | RGBA): string {
  const toHex = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value * 255))).toString(16).padStart(2, '0');
  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
}

// Concrete hex colors from a paint array: solid fills + gradient stops (visible,
// non-transparent). Image fills have no color. Never throws.
function paintHexes(paints: ReadonlyArray<Paint> | PluginAPI['mixed'] | undefined): string[] {
  if (!paints || isMixed(paints)) {
    return [];
  }
  const out: string[] = [];
  for (const paint of paints) {
    if (paint.visible === false) {
      continue;
    }
    if (paint.type === 'SOLID') {
      if ((paint.opacity ?? 1) === 0) {
        continue;
      }
      out.push(solidHex(paint.color));
    } else if (paint.type.startsWith('GRADIENT')) {
      for (const stop of (paint as GradientPaint).gradientStops) {
        if (stop.color.a === 0) {
          continue;
        }
        out.push(solidHex(stop.color));
      }
    }
  }
  return out;
}
```

- [ ] **Step 3: Populate the fields in `extractVisualSummary`.** Replace the function body (`:382-387`):

```ts
  return {
    fills: 'fills' in node ? summarizeFills(node.fills) : 'unknown',
    strokes: 'strokes' in node ? summarizeStrokes(node.strokes) : 'unknown',
    cornerRadius: summarizeCornerRadius(node),
    effects: 'effects' in node ? summarizeEffects(node.effects) : 'none'
  };
```

with:

```ts
  const summary: VisualSummary = {
    fills: 'fills' in node ? summarizeFills(node.fills) : 'unknown',
    strokes: 'strokes' in node ? summarizeStrokes(node.strokes) : 'unknown',
    cornerRadius: summarizeCornerRadius(node),
    effects: 'effects' in node ? summarizeEffects(node.effects) : 'none'
  };
  if ('fills' in node) {
    const hexes = paintHexes(node.fills);
    if (hexes.length > 0) {
      summary.fillColors = hexes;
    }
  }
  if ('strokes' in node) {
    const strokeHexes = paintHexes(node.strokes);
    if (strokeHexes.length > 0) {
      summary.strokeColor = strokeHexes[0];
    }
  }
  return summary;
```

- [ ] **Step 4: Typecheck + build.** Run: `npm run typecheck && npm run build` → clean.

- [ ] **Step 5: Commit.**

```bash
git add src/core/types.ts src/core/extract.ts
git commit -m "feat(bridge): extract fill/stroke hex into the UiSpec (get_spec exposes colors)"
```

---

### Task 2: Use paint colors in DESIGN.md + gate spacing (I6.3 + I7)

**Files:**
- Modify: `src/core/designdoc.ts` (`gatherColorHits` `:106-133`; `collectSpacing` `:320-330`)

- [ ] **Step 1: Ingest paint colors in `gatherColorHits`.** The loop currently is:

```ts
  for (const node of nodes) {
    const css = node.css;
    if (!css) continue;
    if (css['color']) add(parseColor(css['color']), 'text');
    const bg = css['background-color'] ?? css['background'];
    if (bg) {
      if (/gradient/i.test(bg)) hasGradient = true;
      add(extractColor(bg), 'bg');
    }
    if (css['border']) add(extractColor(css['border']), 'border');
  }
```

Replace it with (don't `continue` on missing css — a vector may have paint colors but no css):

```ts
  for (const node of nodes) {
    const css = node.css;
    if (css) {
      if (css['color']) add(parseColor(css['color']), 'text');
      const bg = css['background-color'] ?? css['background'];
      if (bg) {
        if (/gradient/i.test(bg)) hasGradient = true;
        add(extractColor(bg), 'bg');
      }
      if (css['border']) add(extractColor(css['border']), 'border');
    }
    // Paint colors from extraction — captures vector/'mixed' fills the CSS path misses.
    const visual = node.visual;
    if (visual) {
      for (const hex of visual.fillColors ?? []) {
        add(parseColor(hex), 'bg');
      }
      if (visual.strokeColor) {
        add(parseColor(visual.strokeColor), 'border');
      }
    }
  }
```

(`parseColor` handles `#rrggbb`; `add` already de-dupes by hex and ignores `a === 0`.)

- [ ] **Step 2: Frequency-gate `collectSpacing`.** Replace the function (`:320-330`):

```ts
function collectSpacing(nodes: UiNodeSpec[]): number[] {
  const values: number[] = [];
  for (const node of nodes) {
    const l = node.layout;
    if (!l) continue;
    for (const v of [l.itemSpacing, l.paddingTop, l.paddingRight, l.paddingBottom, l.paddingLeft]) {
      if (typeof v === 'number') values.push(v);
    }
  }
  return values;
}
```

with (count by rounded value; keep only values seen ≥2× — drops one-off layout artifacts):

```ts
function collectSpacing(nodes: UiNodeSpec[]): number[] {
  const counts = new Map<number, number>();
  for (const node of nodes) {
    const l = node.layout;
    if (!l) continue;
    for (const v of [l.itemSpacing, l.paddingTop, l.paddingRight, l.paddingBottom, l.paddingLeft]) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
        const key = Math.round(v);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  // Only recurring values are a real spacing scale; one-off layout values are dropped.
  return [...counts.entries()].filter(([, c]) => c >= 2).map(([value]) => value);
}
```

(`buildScale` is unchanged — it de-dupes/sorts/names the gated values. The corner-radius path is untouched.)

- [ ] **Step 3: Typecheck + build.** Run: `npm run typecheck && npm run build` → clean.

- [ ] **Step 4: Commit.**

```bash
git add src/core/designdoc.ts
git commit -m "feat(bridge): DESIGN.md captures paint fill colors; gate spacing scale to recurring values"
```

---

### Task 3: Version bump + verification

**Files:**
- Modify: `package.json`, `src/ui_components.tsx` (footer `version-tag`), `claude-plugin/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (`plugins[0].version`)

- [ ] **Step 1: Bump all four version strings `0.14.11` → `0.14.12`** (UI tag `v1.14.11` → `v1.14.12`; leave marketplace `metadata.version`).

- [ ] **Step 2: Typecheck + both builds.** `npm run typecheck && npm run build` then `cd claude-plugin/mcp && npm run build` → clean; versions consistent.

- [ ] **Step 3: Manual bridge verification** (re-run the dev plugin so the new `dist/code.js` loads; the MCP/`get_spec`/`get_design_md` tools are unchanged):
  - Select a shape/vector with a solid brand fill → `get_spec` → its `uiSpec` node `visual.fillColors` includes the hex (e.g. `#EC4D97`); a bordered node → `visual.strokeColor` is the border hex.
  - `get_design_md` on a selection with vector brand colors → the `colors` frontmatter includes the brand pink + charcoal (not just `surface: #ffffff`).
  - `get_design_md` on a logo-style selection whose only spacing is one-off frame padding → the spacing scale omits those one-offs (only ≥2× values, or empty), no spurious `208/260/344px`.

- [ ] **Step 4: Commit.**

```bash
git add package.json src/ui_components.tsx claude-plugin/.claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "chore: bump versions to 0.14.12 (extraction fidelity)"
```

---

## Notes for the implementer
- `paintHexes` returns `[]` for `figma.mixed` (the whole-property mixed symbol) and for image-only fills — it can't enumerate those; that's expected (no throw).
- `solidHex` is deliberately separate from the existing `rgbToHex` (which appends `(alpha …)` for variable display); fill/stroke hex must be clean `#rrggbb` so `designdoc.parseColor` can consume them.
- No `server.ts`/`server.js` change — `get_spec`/`get_design_md` return the new data through the unchanged tools.
- This completes the eval-remediation render/extraction set except I4 (inline spans) and I5 (negative margins), which remain as separate plans.
