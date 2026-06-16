# I3 — html_to_design render reliability — design

**Date:** 2026-06-16
**Status:** Approved (brainstorming) → ready for implementation plan
**Source:** `docs/DESIGNAGENT-EVALUATION.md` issue I3 (HIGH); remediation plan
`~/.claude/plans/rosy-gathering-avalanche.md` Phase 1.
**Touches:** `src/code.ts`, `claude-plugin/mcp/src/server.ts`, `src/shared/messages.ts`, `src/ui.tsx`.

## Problem

`html_to_design` renders asynchronously in the sandbox, but the bridge responds only after the
**entire** tree is painted. The MCP server's 20s request timeout (`server.ts:26,247-250`) then fires
on slow/large renders and rejects **with no node id**, while the plugin keeps painting. Consequences
(observed live):
- **Orphans:** the frame is created but the caller never gets its id, so it can't be `delete`/
  `select`/`focus`'d (all need an id) — un-cleanable except via the Figma UI.
- **Duplicate frames on retry:** re-rendering adds another orphan.
- **Compounding slowdown:** accumulating nodes make every later render slower, so a file that rendered
  cleanly early starts timing out consistently.
- **Cold-start false-negatives:** the first render(s) time out yet the frame *was* created.

## Goal

`html_to_design` always returns a usable root node id quickly — even for slow/large renders — so
output is verifiable and cleanable; retries replace instead of stacking; and an orphan can be
recovered without the Figma UI.

## Non-goals

- Render *fidelity* (flex/gradients/spans/margins) — that's Phase 2 (I1/I2/I4/I5), separate.
- A completion/"render done" signal or streaming progress — explicitly out (chosen model is
  immediate-id, async paint; the caller verifies with `take_screenshot`). Can be a later v2 progress
  event if needed.
- Broker changes — the relay stays strictly 1:1 request→response.

## Design

### 1. Immediate-id, async paint (`src/code.ts` `createDesignTree`)

Today `createDesignTree` does: resolve parent → `buildDesignNode(tree)` (builds the whole tree
recursively) → post one `DESIGN_TREE_RESULT { id }`.

Change to:
1. Resolve parent (existing `resolveParentContainer`).
2. Create the **root frame shell** — the root node + its *own* props (layout, fills, size, position),
   **without** children. Capture `frame.id`.
3. **Post `DESIGN_TREE_RESULT { ok: true, result: { id, name, rendering: true } }` immediately.** This
   becomes the bridge `response`, so the caller gets the id right away (well under 20s — a frame
   shell needs no font loading).
4. **Then** paint children in the background (the existing recursive `buildDesignNode` per child,
   appended to the root). On success: done (no second response). On error: log to the captured
   console (surfaced via `console_logs`); the partial frame remains, and is **targetable** by the id
   already returned.

Implementation note: factor a "build node shell (props, no children)" step out of `buildDesignNode`
for the **root** only; nested descendants keep using the existing recursive `buildDesignNode`
unchanged. Keep the function focused — if `buildDesignNode` grows awkward, a small `buildNodeShell` +
`appendChildren(parent, childSpecs)` pair is acceptable.

### 2. `replaceId` — idempotent retry

- `html_to_design` gains an optional `replaceId` (`server.ts` inputSchema) → carried on
  `CREATE_DESIGN_TREE` (`messages.ts`) → `createDesignTree`.
- If `replaceId` resolves to an existing node: capture its parent + index + x/y, remove it, and render
  the new tree into that slot (delete-then-create in place). So a retry **replaces** the prior/orphan
  frame instead of stacking a sibling.
- If `replaceId` is given but doesn't resolve (already deleted): render fresh at the default position
  and log a one-line note. Never throw on a stale `replaceId`.

### 3. `list_page_nodes` — orphan-recovery tool

- New read-only bridge tool (`server.ts` registerTool + `code.ts` handler). Returns the current page's
  **top-level** nodes: `[{ id, name, type, x, y, width, height }]` (map `figma.currentPage.children`).
- Lets a caller find an orphan by name/position and `delete` or `replaceId` it without the Figma UI.

### 4. Wire/contract changes (additive)

- `src/shared/messages.ts`: `CREATE_DESIGN_TREE` gains `replaceId?: string`; `DESIGN_TREE_RESULT`
  result gains `rendering?: boolean`.
- `src/ui.tsx`: the `html_to_design` handler passes `replaceId` through to `CREATE_DESIGN_TREE`; the
  `DESIGN_TREE_RESULT` → bridge `response` relay is unchanged (it already forwards `result`).
- `claude-plugin/mcp/src/server.ts`: `html_to_design` inputSchema += `replaceId`; register
  `list_page_nodes`. Update the `html_to_design` description to note it returns the id immediately
  (`rendering: true`), that the render continues in the background (screenshot to verify), and that
  `replaceId` re-renders in place. Timeout constant unchanged.

## Error handling
- Async child-paint error after the early response → `console.*` (captured; `console_logs`), partial
  frame stays targetable. No second response.
- Stale `replaceId` → render fresh + log note.
- Concurrent renders → independent ids; no shared state.

## Verification
- `npm run typecheck` + `npm run build` + `claude-plugin/mcp` build clean.
- Live (Figma + bridge): a large multi-section page returns `{ id, rendering: true }` quickly
  (≪ 20s); the frame is `delete`-able by that id; a `replaceId` retry replaces in place (no
  duplicate); `list_page_nodes` enumerates the page's top-level frames; `take_screenshot` after a beat
  shows the full paint completed.
- Cold-start: first render after opening the plugin returns an id without a timeout error.
- Bump all four version strings (next patch).

## Open questions
None — design approved 2026-06-16.
