# I1 — Flex Exact-Fit Child Drop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Horizontal flex rows reproduced by `html_to_design` never silently drop/overlap a child at exact fit — `flex:1` distributes, content rows hug, `space-between` stays full-width, real overflow shows visibly.

**Architecture:** The renderer (`src/ui_html.ts`) reads each child's `flex-grow` onto the tree. The sandbox builder (`src/code.ts`) uses Figma's native flex sizing: grow children get `layoutGrow=1`; content-packed rows hug (`primaryAxisSizingMode=AUTO`) so there's no fixed width to overflow; rows that must distribute (grow child or `SPACE_BETWEEN`) stay `FIXED` with a clamp that grows the frame to fit its fixed children.

**Tech Stack:** TypeScript; Figma Plugin API in `src/code.ts`. Build: `npm run build` (root). No unit-test framework — the render path needs the Figma sandbox, so verification is `npm run typecheck` + build per task and a manual Figma checklist (Task 3). No `server.ts`/`server.js` change.

**Spec:** `docs/superpowers/specs/2026-06-16-i1-flex-exact-fit-design.md`

---

### Task 1: Capture `flex-grow` (renderer + tree contract)

**Files:**
- Modify: `src/shared/designtree.ts` (add `grow?`)
- Modify: `src/ui_html.ts` (`buildNode` child loop, ~`:234`)

- [ ] **Step 1: Add the tree field.** In `src/shared/designtree.ts`, in `interface DesignTreeNode`, add next to `stretch?`/`absolute?`:

```ts
  grow?: boolean; // flex-grow > 0 on the main axis → Figma layoutGrow=1
```

- [ ] **Step 2: Read `flex-grow` in the child loop.** In `src/ui_html.ts`, `buildNode`'s element-child branch currently is:

```ts
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
      node.children.push(childNode);
```

Add the grow read immediately before `node.children.push(childNode);` (after the existing stretch/absolute block):

```ts
      if (parseFloat(childCs.flexGrow) > 0) {
        childNode.grow = true;
      }
      node.children.push(childNode);
```

(`childCs` is already computed at the top of this branch. `flexGrow` is `'0'` for non-flex children, so this is safe to read unconditionally.)

- [ ] **Step 3: Typecheck + build.**

Run: `npm run typecheck && npm run build`
Expected: clean. (`grow` is set but not yet consumed by the sandbox — no behavior change until Task 2.)

- [ ] **Step 4: Commit.**

```bash
git add src/shared/designtree.ts src/ui_html.ts
git commit -m "feat(bridge): capture flex-grow on the design tree"
```

---

### Task 2: Figma-native flex sizing (sandbox)

**Files:**
- Modify: `src/code.ts` (`buildFrameShell` layout block `:1105-1119`; `appendDesignChildren` `:1126-1137`)

- [ ] **Step 1: Hug-unless-fixed + clamp in `buildFrameShell`.** Replace the current layout block + resize (lines `1105-1119`):

```ts
  if (node.layout) {
    frame.layoutMode = node.layout;
    frame.itemSpacing = node.itemSpacing ?? 0;
    frame.paddingTop = node.paddingTop ?? 0;
    frame.paddingRight = node.paddingRight ?? 0;
    frame.paddingBottom = node.paddingBottom ?? 0;
    frame.paddingLeft = node.paddingLeft ?? 0;
    frame.primaryAxisAlignItems = node.primaryAxisAlign ?? 'MIN';
    frame.counterAxisAlignItems = node.counterAxisAlign ?? 'MIN';
    frame.primaryAxisSizingMode = 'FIXED';
    frame.counterAxisSizingMode = 'FIXED';
  } else {
    frame.layoutMode = 'NONE';
  }
  frame.resize(Math.max(1, node.width), Math.max(1, node.height));
```

with:

```ts
  let resizeW = node.width;
  let resizeH = node.height;
  if (node.layout) {
    frame.layoutMode = node.layout;
    frame.itemSpacing = node.itemSpacing ?? 0;
    frame.paddingTop = node.paddingTop ?? 0;
    frame.paddingRight = node.paddingRight ?? 0;
    frame.paddingBottom = node.paddingBottom ?? 0;
    frame.paddingLeft = node.paddingLeft ?? 0;
    frame.primaryAxisAlignItems = node.primaryAxisAlign ?? 'MIN';
    frame.counterAxisAlignItems = node.counterAxisAlign ?? 'MIN';
    // Hug the main axis for content-packed rows so an exact-fit row has no fixed
    // width to overflow → no silently-dropped child. Stay FIXED only when children
    // must distribute into a width: a grow child (flex:1) or SPACE_BETWEEN.
    const kids = node.children ?? [];
    const needsFixedMain = kids.some((c) => c.grow) || node.primaryAxisAlign === 'SPACE_BETWEEN';
    frame.primaryAxisSizingMode = needsFixedMain ? 'FIXED' : 'AUTO';
    frame.counterAxisSizingMode = 'FIXED';
    if (needsFixedMain) {
      // Clamp: grow the frame to fit its non-grow children rather than mis-flowing /
      // dropping one. (No-op when the measured size already fits.)
      const gaps = Math.max(0, kids.length - 1) * (node.itemSpacing ?? 0);
      if (node.layout === 'HORIZONTAL') {
        const need =
          kids.reduce((s, c) => s + (c.grow ? 0 : c.width), 0) +
          gaps + (node.paddingLeft ?? 0) + (node.paddingRight ?? 0);
        resizeW = Math.max(resizeW, need);
      } else {
        const need =
          kids.reduce((s, c) => s + (c.grow ? 0 : c.height), 0) +
          gaps + (node.paddingTop ?? 0) + (node.paddingBottom ?? 0);
        resizeH = Math.max(resizeH, need);
      }
    }
  } else {
    frame.layoutMode = 'NONE';
  }
  frame.resize(Math.max(1, resizeW), Math.max(1, resizeH));
```

(`frame.resize` on a primary-axis-`AUTO` frame is harmless — Figma hugs that axis regardless once children are appended.)

- [ ] **Step 2: Apply `layoutGrow` in `appendDesignChildren`.** Replace the loop body (lines `1127-1136`):

```ts
  for (const child of node.children ?? []) {
    const created = await buildDesignNode(child, frame);
    if (node.layout && child.absolute && 'layoutPositioning' in created) {
      (created as SceneNode & { layoutPositioning: 'ABSOLUTE' }).layoutPositioning = 'ABSOLUTE';
      (created as SceneNode & LayoutMixin).x = child.x;
      (created as SceneNode & LayoutMixin).y = child.y;
    } else if (node.layout && child.stretch && 'layoutAlign' in created) {
      (created as SceneNode & { layoutAlign: 'STRETCH' }).layoutAlign = 'STRETCH';
    }
  }
```

with (grow + stretch are independent; absolute is out-of-flow so it's exclusive):

```ts
  for (const child of node.children ?? []) {
    const created = await buildDesignNode(child, frame);
    if (!node.layout) {
      continue;
    }
    if (child.absolute && 'layoutPositioning' in created) {
      (created as SceneNode & { layoutPositioning: 'ABSOLUTE' }).layoutPositioning = 'ABSOLUTE';
      (created as SceneNode & LayoutMixin).x = child.x;
      (created as SceneNode & LayoutMixin).y = child.y;
      continue;
    }
    if (child.grow && 'layoutGrow' in created) {
      (created as SceneNode & { layoutGrow: number }).layoutGrow = 1;
    }
    if (child.stretch && 'layoutAlign' in created) {
      (created as SceneNode & { layoutAlign: 'STRETCH' }).layoutAlign = 'STRETCH';
    }
  }
```

- [ ] **Step 3: Typecheck + build.**

Run: `npm run typecheck && npm run build`
Expected: clean (`dist/code.js` written).

- [ ] **Step 4: Commit.**

```bash
git add src/code.ts
git commit -m "feat(bridge): honor flex-grow (layoutGrow) + hug content rows; clamp fixed rows"
```

---

### Task 3: Version bump + verification

**Files:**
- Modify: `package.json`, `src/ui_components.tsx` (footer `version-tag`), `claude-plugin/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (`plugins[0].version`)

- [ ] **Step 1: Bump all four version strings `0.14.10` → `0.14.11`** (UI tag `v1.14.10` → `v1.14.11`; leave marketplace `metadata.version`).

- [ ] **Step 2: Typecheck + both builds.**

Run: `npm run typecheck && npm run build` then `cd claude-plugin/mcp && npm run build`
Expected: clean; versions consistent at `0.14.11` / `v1.14.11`.

- [ ] **Step 3: Manual Figma verification** (re-run the dev plugin). Render via `html_to_design` + `take_screenshot`:
  - **Fixed exact-fit:** `<div style="display:flex;gap:16px;width:1136px">` with four `width:272px` cards → **all four present**, in their own color slots, none dropped.
  - **flex:1 row:** three `style="flex:1"` cards in a flex row → all three present, equal widths.
  - **flex:1 stats:** a flex row of `flex:1` stat blocks → all present, source order preserved.
  - **space-between nav:** `display:flex;justify-content:space-between` with links → links spread full-width, none dropped.
  - **Genuine overflow:** a flex row of fixed children summing wider than the container → it overflows visibly; no child missing.
  - Confirm no regression: a normal vertical column + a row with margin-inset child (absolute) still render as before.

- [ ] **Step 4: Commit.**

```bash
git add package.json src/ui_components.tsx claude-plugin/.claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "chore: bump versions to 0.14.11 (flex exact-fit)"
```

---

## Notes for the implementer
- **Direction-sanity (Task 3):** if a content row that should hug instead renders full-width (or vice-versa), the decision is isolated to the `needsFixedMain` expression in `buildFrameShell` — don't touch the renderer.
- **`grow` + `stretch` coexist** (main-axis grow + counter-axis stretch); only `absolute` is exclusive (out of flow). The restructured loop reflects that.
- **No `server.ts`/`server.js` change** — sandbox + UI only. Don't rebuild/commit the MCP bundle.
- This is the last HIGH from the eval; remaining items (I6/I7 extraction, I4 spans, I5 margins) are separate plans.
