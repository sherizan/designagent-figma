# I3 — html_to_design Render Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `html_to_design` returns the root node id immediately (then paints children in the background), so slow/large renders never produce un-targetable orphans; plus `replaceId` for idempotent retries and a `list_page_nodes` recovery tool.

**Architecture:** Split the sandbox's `buildDesignNode` so the root frame + its own props are created first; `createDesignTree` posts `DESIGN_TREE_RESULT { id, rendering: true }` right after the shell exists, then appends children async. The broker relay stays strictly 1:1. `replaceId` deletes the prior node and renders into its slot. `list_page_nodes` is a new read-only bridge tool.

**Tech Stack:** TypeScript, Figma Plugin API (`figma.*`) in `src/code.ts` (sandbox); React UI iframe `src/ui.tsx` owns the bridge WS; MCP server `claude-plugin/mcp/src/server.ts`. Build: `npm run build` (root) + `cd claude-plugin/mcp && npm run build`. **No test framework — the render path needs the real Figma sandbox, so verification is `npm run typecheck` + builds per task, and a manual Figma checklist at the end (Task 4).** `server.js` is a committed artifact — rebuild + commit it when `server.ts` changes.

**Spec:** `docs/superpowers/specs/2026-06-16-i3-render-reliability-design.md`

---

### Task 1: Immediate-id render (sandbox)

Split `buildDesignNode`'s frame branch into a shell + a children step, and make `createDesignTree` respond as soon as the root frame shell exists.

**Files:**
- Modify: `src/code.ts` (`buildDesignNode` frame branch `:1038-1108`; `createDesignTree` `:1141-1170`)

- [ ] **Step 1: Extract `buildFrameShell` + `appendDesignChildren` from `buildDesignNode`.**

In `src/code.ts`, the frame branch of `buildDesignNode` currently runs lines `1038-1108` (create frame, set fills/stroke/radius/opacity/shadow/layout/size/position, then a `for (const child ...)` loop, then `return frame`). Replace that whole frame branch (from `const frame = figma.createFrame();` through the final `return frame;` at `:1108`) with a call into two new helpers:

```ts
  return buildFrameNode(node, parent);
}

// Create a frame node + its own visual/layout props, WITHOUT children. Sync.
function buildFrameShell(
  node: DesignTreeNode,
  parent: BaseNode & ChildrenMixin
): FrameNode {
  const frame = figma.createFrame();
  parent.appendChild(frame);
  frame.clipsContent = false;
  const fill = cssSolidPaint(node.fill);
  frame.fills = fill ? [fill] : [];
  const stroke = cssSolidPaint(node.stroke);
  if (stroke) {
    frame.strokes = [stroke];
    if (node.strokeWidth && node.strokeWidth > 0) {
      frame.strokeWeight = node.strokeWidth;
    }
  }
  if (node.cornerRadius && node.cornerRadius > 0) {
    frame.cornerRadius = node.cornerRadius;
  }
  if (typeof node.opacity === 'number' && node.opacity < 1) {
    frame.opacity = node.opacity;
  }
  if (node.shadow) {
    const shadowColor = parseCssColor(node.shadow.color);
    if (shadowColor) {
      frame.effects = [
        {
          type: 'DROP_SHADOW',
          color: {
            r: shadowColor.color.r,
            g: shadowColor.color.g,
            b: shadowColor.color.b,
            a: shadowColor.opacity
          },
          offset: { x: node.shadow.x, y: node.shadow.y },
          radius: node.shadow.blur,
          spread: node.shadow.spread,
          visible: true,
          blendMode: 'NORMAL'
        }
      ];
    }
  }
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
  frame.x = node.x;
  frame.y = node.y;
  return frame;
}

// Build and append a frame's children (recurses into buildDesignNode per child).
async function appendDesignChildren(frame: FrameNode, node: DesignTreeNode): Promise<void> {
  for (const child of node.children) {
    const created = await buildDesignNode(child, frame);
    if (node.layout && child.absolute && 'layoutPositioning' in created) {
      (created as SceneNode & { layoutPositioning: 'ABSOLUTE' }).layoutPositioning = 'ABSOLUTE';
      (created as SceneNode & LayoutMixin).x = child.x;
      (created as SceneNode & LayoutMixin).y = child.y;
    } else if (node.layout && child.stretch && 'layoutAlign' in created) {
      (created as SceneNode & { layoutAlign: 'STRETCH' }).layoutAlign = 'STRETCH';
    }
  }
}

// Full frame build (shell + children) — used for nested frames.
async function buildFrameNode(
  node: DesignTreeNode,
  parent: BaseNode & ChildrenMixin
): Promise<SceneNode> {
  const frame = buildFrameShell(node, parent);
  await appendDesignChildren(frame, node);
  return frame;
}
```

(The text/svg/image branches of `buildDesignNode` at `:952-1036` are unchanged — they already have no children. Only the trailing frame branch is replaced by `return buildFrameNode(node, parent);`.)

- [ ] **Step 2: Rewrite `createDesignTree` to respond after the shell.**

Replace `createDesignTree` (`:1141-1170`) with:

```ts
async function createDesignTree(message: {
  id: string;
  tree: DesignTreeNode;
  x?: number;
  y?: number;
  parentId?: string;
  replaceId?: string; // honored in Task 2
}): Promise<void> {
  try {
    const parent = await resolveParentContainer(message.parentId);
    const tree = message.tree;

    if (tree.kind === 'frame') {
      // Create the root frame shell first so its id is available immediately.
      const frame = buildFrameShell(tree, parent);
      if (parent.type === 'PAGE') {
        placeOnPage(frame, message.x, message.y);
      }
      figma.currentPage.selection = [frame];
      figma.viewport.scrollAndZoomIntoView([frame]);
      // Respond NOW — the caller gets a usable id even if painting is slow.
      postToUI({
        type: 'DESIGN_TREE_RESULT',
        id: message.id,
        ok: true,
        result: { id: frame.id, name: frame.name, rendering: true }
      });
      // Paint children in the background; a failure here leaves a partial but
      // targetable frame (the caller already has its id) — surface via console.
      try {
        await appendDesignChildren(frame, tree);
      } catch (error) {
        console.error(
          'html_to_design: background paint failed:',
          error instanceof Error ? error.message : String(error)
        );
      }
      return;
    }

    // Non-frame root (rare): nothing to defer — build fully, then respond.
    const root = await buildDesignNode(tree, parent);
    if (parent.type === 'PAGE' && 'x' in root) {
      placeOnPage(root as SceneNode & LayoutMixin, message.x, message.y);
    }
    figma.currentPage.selection = [root];
    figma.viewport.scrollAndZoomIntoView([root]);
    postToUI({
      type: 'DESIGN_TREE_RESULT',
      id: message.id,
      ok: true,
      result: { id: root.id, name: root.name }
    });
  } catch (error) {
    postToUI({
      type: 'DESIGN_TREE_RESULT',
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
```

- [ ] **Step 3: Typecheck + build.**

Run: `npm run typecheck && npm run build`
Expected: clean; `dist/code.js` + `dist/ui.js` written. (`message.replaceId` is in the param type but unused until Task 2 — fine; `noUnusedLocals` is off.)

- [ ] **Step 4: Commit.**

```bash
git add src/code.ts
git commit -m "feat(bridge): html_to_design returns root id immediately; paint children async"
```

---

### Task 2: `replaceId` — idempotent retry (end-to-end)

Let a render target an existing node (a prior/orphan frame) and replace it in place instead of stacking a new one.

**Files:**
- Modify: `src/shared/messages.ts` (`CREATE_DESIGN_TREE`), `claude-plugin/mcp/src/server.ts` (`html_to_design` schema + pass-through), `src/ui.tsx` (`html_to_design` handler `:416-429`), `src/code.ts` (`createDesignTree`)

- [ ] **Step 1: Add `replaceId` to the message contract.**

In `src/shared/messages.ts`, the `CREATE_DESIGN_TREE` member (`:44-51`) gains `replaceId`:

```ts
  | {
      type: 'CREATE_DESIGN_TREE';
      id: string;
      tree: DesignTreeNode;
      x?: number;
      y?: number;
      parentId?: string;
      replaceId?: string;
    }
```

- [ ] **Step 2: Accept + forward `replaceId` in the MCP tool.**

In `claude-plugin/mcp/src/server.ts`, the `html_to_design` `inputSchema` (`:995-1002`) gains:

```ts
      replaceId: z
        .string()
        .optional()
        .describe(
          'Replace an existing node (e.g. a prior or orphaned render) in place instead of adding a new frame — pass the id returned by an earlier html_to_design call.'
        ),
```

and the `run('html_to_design', { ... })` call (`:1014-1020`) passes it through:

```ts
      return run('html_to_design', {
        html,
        x: args.x,
        y: args.y,
        parentId: args.parentId,
        width: args.width,
        replaceId: args.replaceId
      });
```

Also fix the now-stale "Large pages" line in the `description` (it claimed the call "can exceed the response timeout while it keeps painting" — no longer true once Task 1 returns the id immediately). Replace that final bullet of the description string with:

```
\n- Returns the new frame's id immediately and finishes painting in the background — `take_screenshot` to verify completion. Pass `replaceId` (an id from a prior call) to re-render in place instead of stacking a new frame; render very large pages section-by-section.
```

- [ ] **Step 3: Forward `replaceId` from the UI to the sandbox.**

In `src/ui.tsx`, the `CREATE_DESIGN_TREE` post inside the `html_to_design` handler (`:422-429`) gains a `replaceId` line:

```tsx
              postPluginMessage({
                type: 'CREATE_DESIGN_TREE',
                id: msg.id,
                tree,
                x: typeof params.x === 'number' ? params.x : undefined,
                y: typeof params.y === 'number' ? params.y : undefined,
                parentId: typeof params.parentId === 'string' ? params.parentId : undefined,
                replaceId: typeof params.replaceId === 'string' ? params.replaceId : undefined
              });
```

- [ ] **Step 4: Honor `replaceId` in `createDesignTree`.**

In `src/code.ts` `createDesignTree`, immediately after `const tree = message.tree;` and before the parent is resolved, resolve the replace target, capture its slot, and remove it; then prefer its parent. Replace the `const parent = await resolveParentContainer(message.parentId);` line you wrote in Task 1 with:

```ts
    // If replacing a prior/orphan node, render into its slot (same parent + position).
    let replaceSlot: { x: number; y: number } | null = null;
    let replaceParent: (BaseNode & ChildrenMixin) | null = null;
    if (message.replaceId) {
      const old = await figma.getNodeByIdAsync(message.replaceId);
      if (isSceneNode(old) && old.parent) {
        replaceParent = old.parent as BaseNode & ChildrenMixin;
        replaceSlot = {
          x: 'x' in old ? (old as SceneNode & LayoutMixin).x : 0,
          y: 'y' in old ? (old as SceneNode & LayoutMixin).y : 0
        };
        old.remove();
      } else {
        console.warn('html_to_design: replaceId not found; rendering fresh:', message.replaceId);
      }
    }
    const parent = replaceParent ?? (await resolveParentContainer(message.parentId));
    const tree = message.tree;
```

Then, in the **frame** branch, change the placement so a replace keeps the old slot instead of auto-placing:

```ts
      const frame = buildFrameShell(tree, parent);
      if (replaceSlot) {
        frame.x = replaceSlot.x;
        frame.y = replaceSlot.y;
      } else if (parent.type === 'PAGE') {
        placeOnPage(frame, message.x, message.y);
      }
```

and likewise in the **non-frame** branch:

```ts
    const root = await buildDesignNode(tree, parent);
    if (replaceSlot && 'x' in root) {
      (root as SceneNode & LayoutMixin).x = replaceSlot.x;
      (root as SceneNode & LayoutMixin).y = replaceSlot.y;
    } else if (parent.type === 'PAGE' && 'x' in root) {
      placeOnPage(root as SceneNode & LayoutMixin, message.x, message.y);
    }
```

(`isSceneNode` already exists in `code.ts` — used by the `delete` case at `:1757`.)

- [ ] **Step 5: Typecheck + both builds.**

Run: `npm run typecheck && npm run build` then `cd claude-plugin/mcp && npm run build`
Expected: all clean.

- [ ] **Step 6: Commit.**

```bash
git add src/shared/messages.ts claude-plugin/mcp/src/server.ts claude-plugin/mcp/server.js src/ui.tsx src/code.ts
git commit -m "feat(bridge): html_to_design replaceId — re-render in place instead of stacking"
```

---

### Task 3: `list_page_nodes` recovery tool

A read-only tool to enumerate the current page's top-level nodes so a caller can find and delete/replace an orphan without the Figma UI.

**Files:**
- Modify: `src/code.ts` (bridge switch `:1416`), `claude-plugin/mcp/src/server.ts` (register near `get_spec` `:552`)

- [ ] **Step 1: Add the sandbox handler.**

In `src/code.ts`, in the `switch (command)` block (after the `get_spec` case, `:1430-1433`), add:

```ts
    case 'list_page_nodes': {
      const nodes = figma.currentPage.children.map((child) => ({
        id: child.id,
        name: child.name,
        type: child.type,
        x: 'x' in child ? Math.round((child as SceneNode & LayoutMixin).x) : 0,
        y: 'y' in child ? Math.round((child as SceneNode & LayoutMixin).y) : 0,
        width: 'width' in child ? Math.round((child as SceneNode & LayoutMixin).width) : 0,
        height: 'height' in child ? Math.round((child as SceneNode & LayoutMixin).height) : 0
      }));
      return { page: figma.currentPage.name, count: nodes.length, nodes };
    }
```

- [ ] **Step 2: Register the MCP tool.**

In `claude-plugin/mcp/src/server.ts`, after the `get_spec` registration block (ends `:558`), add:

```ts
server.registerTool(
  'list_page_nodes',
  {
    description:
      "List the current Figma page's top-level nodes (id, name, type, x, y, width, height). Use to find a frame by name/position — e.g. to recover and `delete`/`replaceId` an html_to_design frame whose earlier render is an orphan."
  },
  async () => run('list_page_nodes')
);
```

- [ ] **Step 3: Typecheck + both builds.**

Run: `npm run typecheck && npm run build` then `cd claude-plugin/mcp && npm run build`
Expected: clean; `grep -c list_page_nodes claude-plugin/mcp/server.js` > 0.

- [ ] **Step 4: Commit.**

```bash
git add src/code.ts claude-plugin/mcp/src/server.ts claude-plugin/mcp/server.js
git commit -m "feat(bridge): add list_page_nodes recovery tool"
```

---

### Task 4: Version bump + verification

**Files:**
- Modify: `package.json`, `src/ui_components.tsx` (footer `version-tag`), `claude-plugin/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (`plugins[0].version`)

- [ ] **Step 1: Bump all four version strings `0.14.8` → `0.14.9`** (leave marketplace `metadata.version`). The UI tag is `v1.14.8` → `v1.14.9`.

- [ ] **Step 2: Typecheck + both builds.**

Run: `npm run typecheck && npm run build` then `cd claude-plugin/mcp && npm run build`
Expected: clean; versions consistent at `0.14.9` / `v1.14.9`.

- [ ] **Step 3: Manual Figma verification** (re-run the dev plugin to load the new `dist/`; the running MCP self-heals to the new `server.js`). Confirm:
  - Render a **large** multi-section page via `html_to_design` → the call returns quickly with `{ id, name, rendering: true }` (no 20s timeout, no orphan).
  - `delete` that returned id removes the frame (it was targetable).
  - Re-render with `replaceId` = that id → the frame is replaced in place, **no duplicate** appears.
  - `list_page_nodes` → returns the page's top-level frames with ids/positions.
  - `take_screenshot` a beat after the call → the full page finished painting (background paint completed after the early response).
  - Cold start (first render after opening the plugin) → returns an id, no timeout error.

- [ ] **Step 4: Commit.**

```bash
git add package.json src/ui_components.tsx claude-plugin/.claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "chore: bump versions to 0.14.9 (html_to_design reliability)"
```

---

## Notes for the implementer
- **Broker is untouched** — the relay stays 1:1; the only change is that the sandbox posts its single `DESIGN_TREE_RESULT` earlier (after the root shell) instead of after the full paint.
- **No second response** is sent when background painting finishes or fails (the contract stays 1:1). Errors go to `console.*` (surfaced by `console_logs`).
- **`server.js` is committed** — always rebuild (`cd claude-plugin/mcp && npm run build`) and commit it with `server.ts` changes (Tasks 2, 3).
- This is Phase 1 of the eval remediation (`docs/DESIGNAGENT-EVALUATION.md`); render-fidelity (I1/I2/I4/I5) and extraction (I6/I7) are later, separate plans.
