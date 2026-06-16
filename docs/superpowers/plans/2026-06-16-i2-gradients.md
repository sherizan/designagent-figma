# I2 — CSS Gradient Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `html_to_design` paints `linear-gradient` backgrounds as real Figma `GRADIENT_LINEAR` (angle + stops); `radial`/`conic`/unparseable gradients flatten to the first color stop (never white) with a `console.warn`.

**Architecture:** The gradient rides as a raw CSS string on the tree node (`DesignTreeNode.gradient`), mirroring how `fill` is a CSS color string parsed in the sandbox. `src/ui_html.ts` captures `background-image`; `src/code.ts` parses it into a Figma paint (or a flatten fallback) and applies it in `buildFrameShell`.

**Tech Stack:** TypeScript; Figma Plugin API (`GradientPaint`, `Transform`) in `src/code.ts`. Build: `npm run build` (root). No unit-test framework — the render path needs the Figma sandbox, so verification is `npm run typecheck` + build per task and a manual Figma checklist (Task 3). `server.js` is NOT changed by this feature (no MCP-tool change).

**Spec:** `docs/superpowers/specs/2026-06-16-i2-gradients-design.md`

---

### Task 1: Capture the gradient string (UI + tree contract)

**Files:**
- Modify: `src/shared/designtree.ts` (add `gradient?`)
- Modify: `src/ui_html.ts` (`applyBoxStyles`, ~`:144`)

- [ ] **Step 1: Add the tree field.** In `src/shared/designtree.ts`, in `interface DesignTreeNode`, add (next to `fill?: string;`):

```ts
  gradient?: string; // raw CSS background-image gradient string, parsed sandbox-side
```

- [ ] **Step 2: Read `background-image` in the DOM walk.** In `src/ui_html.ts`, find where `applyBoxStyles` sets the background fill (currently around `:144`):

```ts
  if (isVisibleColor(cs.backgroundColor)) {
    node.fill = cs.backgroundColor;
  }
```

Add gradient capture immediately after it:

```ts
  const bgImage = cs.backgroundImage;
  if (bgImage && /gradient\(/i.test(bgImage)) {
    node.gradient = bgImage;
  }
```

(`node.fill` from `backgroundColor` stays as a fallback — it's usually `rgba(0,0,0,0)`/transparent when a gradient is set, which `cssSolidPaint` rejects, so it won't override the gradient.)

- [ ] **Step 3: Typecheck + build.**

Run: `npm run typecheck && npm run build`
Expected: clean. (`node.gradient` is set but not yet consumed — the sandbox ignores unknown fields; no behavior change until Task 2.)

- [ ] **Step 4: Commit.**

```bash
git add src/shared/designtree.ts src/ui_html.ts
git commit -m "feat(bridge): capture CSS gradient background-image on the design tree"
```

---

### Task 2: Parse + paint gradients (sandbox)

Add gradient parsing helpers and apply them in `buildFrameShell`.

**Files:**
- Modify: `src/code.ts` (new helpers near `parseCssColor` `:1214` / `cssSolidPaint` `:1241`; `buildFrameShell` fill assignment `:1041-1042`)

- [ ] **Step 1: Add the gradient helpers.** In `src/code.ts`, immediately after `cssSolidPaint` (ends ~`:1244`), add:

```ts
// CSS linear-gradient angle (0deg = up, clockwise) → Figma gradientTransform.
// Figma's default gradient runs along local +x (left→right), which equals CSS 90deg,
// so we rotate by (angle - 90) about the box center (0.5, 0.5). Verified against
// 0/90/135/180deg. Screen y is down, so [[cos,sin],[-sin,cos]] rotates clockwise.
function linearGradientTransform(angleDeg: number): Transform {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [
    [cos, sin, 0.5 - 0.5 * cos - 0.5 * sin],
    [-sin, cos, 0.5 + 0.5 * sin - 0.5 * cos]
  ];
}

// "to top|right|bottom|left|<corner>" → CSS angle in degrees.
function sideToAngle(side: string): number {
  const s = side.replace(/^to\s+/, '').trim().toLowerCase();
  const set = new Set(s.split(/\s+/));
  if (set.has('top') && set.has('right')) return 45;
  if (set.has('bottom') && set.has('right')) return 135;
  if (set.has('bottom') && set.has('left')) return 225;
  if (set.has('top') && set.has('left')) return 315;
  if (set.has('top')) return 0;
  if (set.has('right')) return 90;
  if (set.has('bottom')) return 180;
  if (set.has('left')) return 270;
  return 180; // default: to bottom
}

// Split a gradient's argument list on top-level commas (ignoring commas inside rgb()/rgba()).
function splitTopLevelCommas(input: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of input) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// Parse "color [pos%]" stop segments into Figma ColorStops (positions evenly spread when absent).
function parseGradientStops(segments: string[]): ColorStop[] {
  const parsed = segments.map((seg) => {
    const m = /\s+(-?[\d.]+)%\s*$/.exec(seg);
    const pos = m ? Number(m[1]) / 100 : null;
    const colorStr = m ? seg.slice(0, m.index).trim() : seg;
    const c = parseCssColor(colorStr);
    return c ? { pos, color: { r: c.color.r, g: c.color.g, b: c.color.b, a: c.opacity } } : null;
  });
  const valid = parsed.filter((s): s is { pos: number | null; color: RGBA } => s !== null);
  if (valid.length === 0) return [];
  return valid.map((s, i) => ({
    position: s.pos ?? (valid.length === 1 ? 0 : i / (valid.length - 1)),
    color: s.color
  }));
}

// Parse a CSS linear-gradient into a Figma GRADIENT_LINEAR paint. Returns null for
// radial/conic/repeating/unparseable (caller flattens).
function cssGradientPaint(input: string): GradientPaint | null {
  const m = /^\s*linear-gradient\(([\s\S]*)\)\s*$/i.exec(input.trim());
  if (!m || !m[1]) return null;
  const parts = splitTopLevelCommas(m[1]);
  if (parts.length < 2) return null;
  let angle = 180; // default: to bottom
  let stopParts = parts;
  const first = parts[0]!;
  if (/^to\s+/i.test(first)) {
    angle = sideToAngle(first);
    stopParts = parts.slice(1);
  } else if (/(-?[\d.]+)\s*deg\s*$/i.test(first)) {
    angle = Number(/(-?[\d.]+)\s*deg\s*$/i.exec(first)![1]);
    stopParts = parts.slice(1);
  }
  const stops = parseGradientStops(stopParts);
  if (stops.length < 2) return null;
  return { type: 'GRADIENT_LINEAR', gradientTransform: linearGradientTransform(angle), gradientStops: stops };
}

// First parseable color in any gradient string — for the flatten fallback (radial/conic/etc.).
function firstGradientStopColor(input: string): string | null {
  const m = /gradient\(([\s\S]*)\)\s*$/i.exec(input.trim());
  if (!m || !m[1]) return null;
  for (const seg of splitTopLevelCommas(m[1])) {
    if (/^to\s+/i.test(seg) || /(deg|rad|turn|grad)\s*$/i.test(seg) || /^(circle|ellipse|closest|farthest|at\b)/i.test(seg)) {
      continue; // skip direction / radial-shape tokens
    }
    const colorStr = seg.replace(/\s+-?[\d.]+%\s*$/, '').trim();
    if (parseCssColor(colorStr)) return colorStr;
  }
  return null;
}
```

(`Transform`, `GradientPaint`, `ColorStop`, `RGBA` are Figma plugin-typing globals — no import needed. `parseCssColor` returns `{ color: { r, g, b }, opacity } | null`, as used by the shadow code at `:1057`.)

- [ ] **Step 2: Apply gradient fill in `buildFrameShell`.** In `src/code.ts`, `buildFrameShell` currently sets the fill with:

```ts
  const fill = cssSolidPaint(node.fill);
  frame.fills = fill ? [fill] : [];
```

Replace those two lines with:

```ts
  frame.fills = resolveFrameFill(node);
```

and add this helper just above `buildFrameShell`:

```ts
// Resolve a frame's paint: a real gradient when possible, else a flattened gradient
// color (never white), else the solid background color.
function resolveFrameFill(node: DesignTreeNode): Paint[] {
  if (node.gradient) {
    const gradient = cssGradientPaint(node.gradient);
    if (gradient) {
      return [gradient];
    }
    const flat = cssSolidPaint(firstGradientStopColor(node.gradient));
    if (flat) {
      console.warn('html_to_design: gradient flattened (unsupported/unparseable):', node.gradient);
      return [flat];
    }
  }
  const solid = cssSolidPaint(node.fill);
  return solid ? [solid] : [];
}
```

- [ ] **Step 3: Typecheck + build.**

Run: `npm run typecheck && npm run build`
Expected: clean (`dist/code.js` written).

- [ ] **Step 4: Commit.**

```bash
git add src/code.ts
git commit -m "feat(bridge): paint CSS linear-gradient; flatten radial/conic to first stop"
```

---

### Task 3: Version bump + verification

**Files:**
- Modify: `package.json`, `src/ui_components.tsx` (footer `version-tag`), `claude-plugin/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (`plugins[0].version`)

- [ ] **Step 1: Bump all four version strings `0.14.9` → `0.14.10`** (UI tag `v1.14.9` → `v1.14.10`; leave marketplace `metadata.version`).

- [ ] **Step 2: Typecheck + both builds.**

Run: `npm run typecheck && npm run build` then `cd claude-plugin/mcp && npm run build`
Expected: clean; versions consistent at `0.14.10` / `v1.14.10`.

- [ ] **Step 3: Manual Figma verification** (re-run the dev plugin to load the new `dist/`). Render each via `html_to_design` and `take_screenshot`:
  - `<div style="width:300px;height:120px;background:linear-gradient(135deg,#2A2A2E,#18181B)"></div>` → dark diagonal gradient, top-left lighter → bottom-right darker (NOT white).
  - `linear-gradient(150deg,#EC4D97,#B02868)` → pink→magenta at that angle.
  - `linear-gradient(#ffffff,#000000)` (no angle → to bottom) → white top → black bottom.
  - `linear-gradient(90deg, red, blue)` → red left → blue right.
  - `radial-gradient(circle, #EC4D97, #18181B)` → a flat `#EC4D97` fill (first stop, NOT white) + a warning in `console_logs`.

- [ ] **Step 4: Commit.**

```bash
git add package.json src/ui_components.tsx claude-plugin/.claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "chore: bump versions to 0.14.10 (gradient rendering)"
```

---

## Notes for the implementer
- **Direction sanity-check (Task 3):** the `linearGradientTransform` was derived for CSS's "0deg = up, clockwise" convention and verified at 0/90/135/180deg. If a rendered gradient looks **mirrored/reversed**, the fix is isolated to that one function — do not change the parsing.
- **Never throw out of `resolveFrameFill`:** a malformed gradient must degrade (flatten/solid/empty), never break the render. The helpers return `null` rather than throwing; keep it that way.
- **No `server.ts`/`server.js` change** — this is sandbox + UI only. Don't rebuild/commit the MCP bundle for this feature.
- This is Phase 2 (first item) of the eval remediation; I1 flex, I6/I7 extraction, I4 spans, I5 margins remain as separate plans.
