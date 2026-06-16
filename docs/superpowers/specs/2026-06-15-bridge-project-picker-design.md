# Bridge project picker — design

**Date:** 2026-06-15
**Status:** Approved (brainstorming) → ready for implementation plan
**Touches:** `claude-plugin/mcp/src/broker.ts`, `claude-plugin/mcp/src/server.ts`, `src/ui.tsx`, `src/ui_components.tsx`, `src/code.ts` (panel height). (`src/shared/messages.ts` only if a new plugin↔UI message proves necessary — see §5.)

## Problem

The DesignAgent plugin's "Port Claude's HTML artifacts" panel and DESIGN.md sync read/write files
in a project folder. That folder (`PROJECT_ROOT`) is currently fixed at MCP-server startup to:

```ts
const PROJECT_ROOT = process.env.DESIGNAGENT_PROJECT_DIR
  ? resolve(process.env.DESIGNAGENT_PROJECT_DIR)
  : process.cwd();
```

Two failures result:

1. **Wrong default.** `process.cwd()` is not reliably the user's workspace. Observed: a session
   started in `/Users/sherizan/Public/playground/figma` scans `/Users/sherizan` (home), because the
   server process didn't inherit the workspace cwd. The harness *does* expose the correct directory
   as the env var `CLAUDE_PROJECT_DIR`, but the code ignores it.
2. **Multi-session ambiguity.** Filesystem ops travel a **reverse channel**: the plugin (UI iframe,
   which owns the WebSocket to the broker) sends a `server_request` → the broker relays it to the
   **active = newest** registered session → that session's server runs the op against *its*
   `PROJECT_ROOT`. With several Claude/Cursor windows connected, the scanned folder is whichever
   session registered last — not necessarily the project the user is looking at. There is no way to
   correct it from the UI.

The user regularly has several sessions connected, so a smarter default alone is insufficient.

## Goal

Let the user **pick which connected project** is active, then have **every** reverse-channel
filesystem op use it — both the "Port HTML artifacts" scan (code→design) and DESIGN.md create/
update/sync (design→code), including the path shown on the DESIGN.md card. Each connected session
already knows its own correct root (via `CLAUDE_PROJECT_DIR`), so no path typing is required — the
user selects a project and the broker pins reverse-channel routing to that session.

The picker is a **gate step after the bridge connects**: connect → pick project → then the tabs and
content render. When exactly one project is connected it auto-selects and the gate is skipped;
with several, an explicit pick is required. The picker stays reachable afterwards to switch.

## Non-goals

- Changing the forward tool-call channel (MCP tool → plugin) or the `hello_ack` / green-dot pairing
  logic. The picker affects **only** the reverse (filesystem) channel.
- Persisting the selection across broker restarts (a fresh broker starts on "newest").
- An OS-native folder picker (the plugin iframe and the MCP server can't open OS dialogs).
- Per-path overrides within a session (rejected approach C — leaky under multi-session).

## Architecture

Two independent channels through the broker, unchanged in spirit:

- **Forward** (per session): `MCP tool → server → broker → plugin → Figma → response`. Routed back
  to the originating session via `requestOrigin`. **Untouched by this change.**
- **Reverse** (filesystem): `plugin UI → broker → selected/active session's server → fs op against
  PROJECT_ROOT → response`. **This is what the picker steers.**

### 1. Root detection (`server.ts`)

Replace the `PROJECT_ROOT` constant with an ordered resolver, evaluated once at startup:

1. `DESIGNAGENT_PROJECT_DIR` (explicit override) — `resolve()`d.
2. `CLAUDE_PROJECT_DIR` (harness-provided workspace) — `resolve()`d.
3. Nearest ancestor containing `.git`, walking up from `process.cwd()` (git project root).
4. `process.cwd()` (last resort).

Derive a display `label` from the resolved root: the last 1–2 path segments (e.g.
`playground/figma`), enough to disambiguate sibling projects in the dropdown. Both `PROJECT_ROOT`
and `label` are computed at startup; no runtime mutation.

### 2. Session registry carries root (`server.ts` + `broker.ts`)

- `server.ts`: the `register` message gains `root: PROJECT_ROOT` and `label`.
- `broker.ts`: `ServerClient` gains `root` and `label` fields, populated on register. These are
  additive/optional fields — older servers omit them and the broker tolerates that (label falls back
  to the sessionId prefix, root to empty/unknown).

### 3. Selection + reverse-channel routing (`broker.ts`)

- Add `selectedSessionId: string | null` (broker-global; there is one plugin, so global is correct).
- Reverse-channel routing currently targets `activeServer()` (newest). Change the resolution to a
  helper `routeTarget()`:
  - the session whose `sessionId === selectedSessionId`, if set **and** still connected;
  - otherwise `activeServer()` (newest), and clear a stale `selectedSessionId`.
- When the selected session disconnects (`dropServer`), fall back to newest and re-broadcast the
  session list so the UI reflects the new effective selection.

### 4. Plugin ↔ broker messages

New wire messages (additive; both peers ignore unknown types):

- **Broker → plugin:** `{ type: 'sessions', sessions: [{ id, label, root, selected: boolean }] }`.
  Sent when: the plugin sends `hello`; a session registers or drops; the selection changes.
- **Plugin → broker:** `{ type: 'select_session', sessionId: string }`. The broker sets
  `selectedSessionId` (validating the id is connected), re-broadcasts `sessions`. A `sessionId` that
  is unknown/disconnected is ignored (broker re-broadcasts the unchanged truth).

`BROKER_PROTOCOL_VERSION` is **not** bumped — the additions are backward-compatible optional
fields/messages (consistent with the build-stamp change in 0.14.1).

### 5. UI (`ui.tsx` + `ui_components.tsx`)

Current structure: the panel is gated on `bridgeStatus === 'connected'`; once connected it renders
the two main tabs (`MainTabs`: `design-to-code`, `code-to-design`) and their content. The picker
inserts a gate **between** the connected state and the tabs.

- **`ui.tsx`** (owns the WS): handle inbound `sessions` → store `{ id, label, root, selected }[]`
  and the effective selection in state. Add `selectSession(id)` that sends `select_session`, then
  re-issues the reverse-channel reads (`list_html_files`, and the DESIGN.md existence check) so the
  root, file list, and DESIGN.md card path refresh to the new project.
  - **Gate logic:** once `connected`, before rendering `MainTabs`:
    - 0 sessions → existing "not connected"/empty messaging.
    - exactly 1 session → auto-select it; render tabs immediately (gate skipped).
    - ≥2 sessions and nothing selected yet → render the **project-selection step** (the list of
      connected projects) instead of the tabs; once the user picks, render the tabs.
  - The selected project is the single source of truth for the displayed root in **both** tabs.
- **`ui_components.tsx`:**
  - A `ProjectPicker` component used in two places: (a) the full-width gate step (project list with
    `label` + dimmed `root`, click to select), and (b) a compact "Project: {label} ▾" control shown
    near the tabs once selected, to re-open the picker and switch.
  - The code→design panel's "Scanning: {root}" uses the selected session's `root`.
  - The design→code DESIGN.md card (currently shows `${designRoot}/DESIGN.md`) uses the selected
    session's `root` for `designRoot`, so create/update writes land in the picked project. (This is
    already enforced server-side because all reverse-channel ops route to the selected session per
    §3; the UI just needs to *display* the selected root consistently.)
- **Panel height:** reduce the plugin window from `height: 720` to `height: 560` in
  `src/code.ts` (`figma.showUI`, width stays 400). Verify the gate step and both tabs still fit /
  scroll cleanly at the shorter height.
- **`src/shared/messages.ts`:** **likely untouched.** The `sessions` / `select_session` wire
  messages are a UI↔broker concern handled directly in `ui.tsx` and do not cross the UI↔sandbox
  boundary (the sandbox/`code.ts` is not involved in reverse-channel fs ops). Only touch it if a new
  plugin↔UI message turns out to be needed.

### 6. Edge cases

- **Selected session disconnects** → broker falls back to newest, clears selection, re-broadcasts
  `sessions`; UI shows the new effective selection.
- **No sessions connected** → existing "bridge not connected" messaging; dropdown shows nothing /
  disabled.
- **Single session** → gate auto-skips (auto-selected); a compact "Project: {label}" control still
  shows near the tabs (becomes a switcher if a second session later connects).
- **Selection not persisted** → after a broker restart (incl. the 0.14.1 self-heal), routing starts
  at "newest" until the user picks again. Acceptable per non-goals.
- **Duplicate labels** (two projects with the same basename) → label uses up to 2 path segments;
  ties are still selectable by row and the full `root` is shown in "Scanning:".

### 7. Versioning + verification

- Bridge change → bump all four version strings together to **0.14.2** (`package.json`,
  `src/ui_components.tsx` version tag `v1.14.2`, `claude-plugin/.claude-plugin/plugin.json`,
  `.claude-plugin/marketplace.json` `plugins[0].version`).
- Verify:
  - `npm run typecheck` (root) clean; Figma plugin builds (`npm run build`).
  - MCP bundle builds (`claude-plugin/mcp` `npm run build`).
  - Broker handshake test: register two fake sessions with distinct roots (e.g. `/a` and `/b`),
    confirm reverse-channel routing targets newest by default; send `select_session` for the older
    one; confirm a subsequent `server_request` is relayed to the selected session, not newest;
    disconnect the selected session and confirm fallback to newest + a fresh `sessions` broadcast.
  - Manual (multi-session): with two sessions connected, confirm the gate step lists both; selecting
    one updates "Scanning:" + the HTML file list, **and** the DESIGN.md card path; a DESIGN.md
    create/update writes into the *selected* project's folder (not the newest session's).
  - Manual (single session): confirm the gate auto-skips straight to the tabs.
  - Manual (layout): confirm the gate step and both tabs fit/scroll cleanly at the 560px height.

## Open questions

None — design approved 2026-06-15.
