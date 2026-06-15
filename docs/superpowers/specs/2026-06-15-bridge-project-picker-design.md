# Bridge project picker — design

**Date:** 2026-06-15
**Status:** Approved (brainstorming) → ready for implementation plan
**Touches:** `claude-plugin/mcp/src/broker.ts`, `claude-plugin/mcp/src/server.ts`, `src/ui.tsx`, `src/ui_components.tsx`. (`src/shared/messages.ts` only if a new plugin↔UI message proves necessary — see §5.)

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

Let the user **pick which connected project** the plugin scans, from a dropdown in the panel. Each
connected session already knows its own correct root (via `CLAUDE_PROJECT_DIR`), so no path typing
is required — the user selects a project and the broker pins reverse-channel routing to that
session.

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

### 5. UI (`ui.tsx` + `ui_components.tsx` + `src/shared/messages.ts`)

- `ui.tsx` (owns the WS): handle inbound `sessions` → store `{ id, label, root, selected }[]` in
  state. Add a `selectSession(id)` that sends `select_session` and then re-issues `list_html_files`
  so root + file list refresh.
- `ui_components.tsx`: in the "Port Claude's HTML artifacts" panel, render a **Project** dropdown
  above "Scanning: {root}" listing the connected projects by `label`, the selected one marked. With
  a single connected session, render it as a static label (no dropdown). The selected session's
  `root` drives the "Scanning:" line.
- `src/shared/messages.ts`: **likely untouched.** The `sessions` / `select_session` wire messages are
  a UI↔broker concern handled directly in `ui.tsx` and do not cross the UI↔sandbox boundary (the
  sandbox/`code.ts` is not involved in reverse-channel fs ops). Only touch `messages.ts` if a new
  plugin↔UI message turns out to be needed.

### 6. Edge cases

- **Selected session disconnects** → broker falls back to newest, clears selection, re-broadcasts
  `sessions`; UI shows the new effective selection.
- **No sessions connected** → existing "bridge not connected" messaging; dropdown shows nothing /
  disabled.
- **Single session** → static label, no dropdown.
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
  - Manual: with two sessions connected, confirm the dropdown lists both, selecting one updates
    "Scanning:" and the HTML file list to that project.

## Open questions

None — design approved 2026-06-15.
