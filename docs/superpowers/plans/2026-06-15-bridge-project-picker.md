# Bridge Project Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user pick which connected Claude/Cursor project the DesignAgent plugin reads & writes (HTML scan + DESIGN.md), via a gate step shown after the bridge connects.

**Architecture:** Each MCP server detects its own project root (`CLAUDE_PROJECT_DIR` → git root → cwd) and reports it to the broker on register. The broker tracks all connected sessions, lets the plugin pick one (`select_session`), and pins the reverse (filesystem) channel to it. The plugin UI shows a project gate after connecting and a compact switcher afterward. The forward tool-call channel and green-dot pairing are untouched.

**Tech Stack:** TypeScript (strict), esbuild bundles, React 18 (UI iframe), `ws` WebSocket broker daemon. No test framework — broker logic is verified with runnable Node assertion scripts; UI/server via `npm run typecheck`, builds, and a manual Figma checklist.

**Spec:** `docs/superpowers/specs/2026-06-15-bridge-project-picker-design.md`

**Conventions:**
- Root build + typecheck: `npm run build`, `npm run typecheck` (run from repo root).
- MCP build: `cd claude-plugin/mcp && npm run build` (esbuild → `server.js`; does NOT typecheck).
- `BROKER_PROTOCOL_VERSION` stays `2` — all new wire fields/messages are additive & optional.
- Commit after each task.

---

### Task 1: Project-root detection module + server wiring

Extract root detection into a pure, testable module and use it in the server; report `root`+`label` on register.

**Files:**
- Create: `claude-plugin/mcp/src/project-root.ts`
- Test (throwaway, not committed): `/tmp/project-root.test.cjs`
- Modify: `claude-plugin/mcp/src/server.ts` (imports line 1–11; register block line 95–108; `PROJECT_ROOT` block line 330–332)

- [ ] **Step 1: Write the pure module**

Create `claude-plugin/mcp/src/project-root.ts`:

```ts
// Resolve the project directory the plugin's filesystem ops act on, and a short
// label for the picker UI. Pure + dependency-injected so it's unit-testable.
import { existsSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';

export interface ResolveProjectRootOpts {
  projectDirEnv?: string | undefined; // DESIGNAGENT_PROJECT_DIR (explicit override)
  claudeProjectDir?: string | undefined; // CLAUDE_PROJECT_DIR (harness workspace)
  cwd: string;
  gitRootOf?: (start: string) => string | null; // injectable for tests
}

// Nearest ancestor containing a `.git` entry, walking up from `start`.
export function findGitRoot(start: string): string | null {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(resolve(dir, '.git'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null; // reached filesystem root
    }
    dir = parent;
  }
}

// Priority: explicit override → harness workspace → git root → cwd.
export function resolveProjectRoot(opts: ResolveProjectRootOpts): string {
  const override = opts.projectDirEnv?.trim();
  if (override) {
    return resolve(override);
  }
  const workspace = opts.claudeProjectDir?.trim();
  if (workspace) {
    return resolve(workspace);
  }
  const gitRoot = (opts.gitRootOf ?? findGitRoot)(opts.cwd);
  if (gitRoot) {
    return gitRoot;
  }
  return resolve(opts.cwd);
}

// Last 1–2 path segments, e.g. /Users/me/Public/playground/figma → "playground/figma".
export function deriveProjectLabel(root: string): string {
  const parts = resolve(root)
    .split(sep)
    .filter(Boolean);
  if (parts.length === 0) {
    return root;
  }
  return parts.slice(-2).join('/');
}
```

- [ ] **Step 2: Write the failing test**

Create `/tmp/project-root.test.cjs` (builds the real module standalone via esbuild, then asserts):

```js
const { execSync } = require('node:child_process');
const assert = require('node:assert');

// Build just the pure module to CJS so we can require the REAL code.
execSync(
  'npx esbuild src/project-root.ts --bundle --platform=node --format=cjs --outfile=/tmp/project-root.cjs',
  { cwd: process.cwd(), stdio: 'inherit' }
);
const { resolveProjectRoot, deriveProjectLabel } = require('/tmp/project-root.cjs');

// 1. explicit override wins
assert.strictEqual(
  resolveProjectRoot({ projectDirEnv: '/x/over', claudeProjectDir: '/y', cwd: '/z' }),
  '/x/over'
);
// 2. CLAUDE_PROJECT_DIR beats cwd/git
assert.strictEqual(
  resolveProjectRoot({ claudeProjectDir: '/y/work', cwd: '/z', gitRootOf: () => '/g' }),
  '/y/work'
);
// 3. git root beats cwd when no env
assert.strictEqual(
  resolveProjectRoot({ cwd: '/z/sub', gitRootOf: () => '/z' }),
  '/z'
);
// 4. cwd is the last resort
assert.strictEqual(
  resolveProjectRoot({ cwd: '/z/only', gitRootOf: () => null }),
  '/z/only'
);
// 5. label = last 1–2 segments
assert.strictEqual(deriveProjectLabel('/Users/me/Public/playground/figma'), 'playground/figma');
assert.strictEqual(deriveProjectLabel('/solo'), 'solo');

console.log('project-root: ALL PASS');
```

- [ ] **Step 3: Run the test, expect FAIL**

Run: `cd claude-plugin/mcp && node /tmp/project-root.test.cjs`
Expected: FAIL — esbuild errors (module not yet created) or assertion error. (If Step 1 is already saved, it should pass; the point is to confirm the test actually exercises the module.)

- [ ] **Step 4: Run the test, expect PASS**

Run: `cd claude-plugin/mcp && node /tmp/project-root.test.cjs`
Expected: `project-root: ALL PASS`

- [ ] **Step 5: Wire the module into `server.ts`**

In `claude-plugin/mcp/src/server.ts`, add to the import block (after line 11):

```ts
import { resolveProjectRoot, deriveProjectLabel } from './project-root';
```

Replace the `PROJECT_ROOT` block (currently lines 330–332):

```ts
// The directory all reverse-channel filesystem ops act on. Priority:
// DESIGNAGENT_PROJECT_DIR → CLAUDE_PROJECT_DIR (harness workspace) → git root → cwd.
const PROJECT_ROOT = resolveProjectRoot({
  projectDirEnv: process.env.DESIGNAGENT_PROJECT_DIR,
  claudeProjectDir: process.env.CLAUDE_PROJECT_DIR,
  cwd: process.cwd()
});
const PROJECT_LABEL = deriveProjectLabel(PROJECT_ROOT);
```

In the `register` send (currently lines 97–104), add `root` and `label`:

```ts
        socket.send(
          JSON.stringify({
            type: 'register',
            role: 'mcp-server',
            sessionId: SERVER_INSTANCE_ID,
            version: BROKER_PROTOCOL_VERSION,
            buildMtime: BUILD_MTIME,
            root: PROJECT_ROOT,
            label: PROJECT_LABEL
          })
        );
```

- [ ] **Step 6: Build the MCP bundle**

Run: `cd claude-plugin/mcp && npm run build`
Expected: `server.js` written, no esbuild errors.

- [ ] **Step 7: Commit**

```bash
git add claude-plugin/mcp/src/project-root.ts claude-plugin/mcp/src/server.ts claude-plugin/mcp/server.js
git commit -m "feat(bridge): detect project root via CLAUDE_PROJECT_DIR→git→cwd; send root+label on register"
```

---

### Task 2: Broker — session registry fields + selection-aware routing

Store each session's `root`/`label`; route the reverse channel to a selected session (falling back to newest). No selection mechanism yet, so behavior is unchanged until Task 3.

**Files:**
- Modify: `claude-plugin/mcp/src/broker.ts` (`ServerClient` line 55–58; inbound msg type line 137–149; register handler line 174–202; reverse-channel block line 216–230)

- [ ] **Step 1: Extend `ServerClient` + add selection state**

Replace the `ServerClient` interface (lines 55–58):

```ts
interface ServerClient {
  socket: WebSocket;
  sessionId: string;
  root: string;
  label: string;
}
```

Inside `runBroker()`, just after `const servers: ServerClient[] = [];` (line 63), add:

```ts
  // sessionId the plugin explicitly picked for filesystem ops; null = follow newest.
  let selectedSessionId: string | null = null;
```

- [ ] **Step 2: Add `routeTarget()` helper**

Just after `activeServer()` (after line 72), add:

```ts
  // The session that should receive reverse-channel (filesystem) ops: the one the
  // plugin selected if it's still connected, else the newest. Clears a stale pick.
  function routeTarget(): ServerClient | null {
    if (selectedSessionId) {
      const picked = servers.find((s) => s.sessionId === selectedSessionId);
      if (picked) {
        return picked;
      }
      selectedSessionId = null;
    }
    return activeServer();
  }
```

- [ ] **Step 3: Capture `root`/`label` on register**

In the inbound `msg` type (lines 137–149), add fields:

```ts
        root?: string;
        label?: string;
```

In the register handler, replace the push (line 194):

```ts
        const root = typeof msg.root === 'string' ? msg.root : '';
        const label = typeof msg.label === 'string' && msg.label ? msg.label : sessionId.slice(0, 8);
        // Newest registration becomes active.
        servers.push({ socket, sessionId, root, label });
```

- [ ] **Step 4: Route the reverse channel via `routeTarget()`**

In the `server_request` block (lines 216–230), replace `const active = activeServer();` with:

```ts
          const target = routeTarget();
```

and update the two following references from `active` to `target` (the `if (!active)` guard and `send(active.socket, msg)`):

```ts
          if (!target) {
            send(plugin, {
              type: 'server_response',
              id: msg.id,
              ok: false,
              error: 'No active Claude session is connected to the bridge.'
            });
            return;
          }
          send(target.socket, msg);
          return;
```

- [ ] **Step 5: Build + sanity-check routing unchanged**

Run: `cd claude-plugin/mcp && npm run build`
Expected: builds clean. (Routing still resolves to newest because `selectedSessionId` is always null until Task 3 — safe intermediate state.)

- [ ] **Step 6: Commit**

```bash
git add claude-plugin/mcp/src/broker.ts claude-plugin/mcp/server.js
git commit -m "feat(bridge): broker tracks session root/label; route reverse channel via routeTarget()"
```

---

### Task 3: Broker — session list broadcast + `select_session`

Broadcast the connected-session list to the plugin and accept the plugin's selection.

**Files:**
- Modify: `claude-plugin/mcp/src/broker.ts` (add `broadcastSessions`; call on hello/register/drop/select; handle `select_session`)
- Test (throwaway, not committed): `claude-plugin/mcp/picker-handshake.test.mjs`

- [ ] **Step 1: Add `broadcastSessions()`**

Inside `runBroker()`, just after `ackPlugin()` (after line 94), add:

```ts
  // Tell the plugin which projects are connected and which is the effective target.
  function broadcastSessions(): void {
    if (!plugin) {
      return;
    }
    const target = routeTarget();
    send(plugin, {
      type: 'sessions',
      sessions: servers.map((s) => ({
        id: s.sessionId,
        label: s.label,
        root: s.root,
        selected: target ? s.sessionId === target.sessionId : false
      }))
    });
  }
```

- [ ] **Step 2: Broadcast on plugin hello**

In the `hello` handler (lines 166–170), after `ackPlugin();` add `broadcastSessions();`:

```ts
      if (msg.type === 'hello' && msg.role === 'figma-plugin') {
        plugin = socket;
        blog('plugin connected.');
        ackPlugin(); // no-op until a session is active; then the plugin pairs
        broadcastSessions();
        return;
      }
```

- [ ] **Step 3: Broadcast on register and on drop**

In the register handler, after `ackPlugin();` (line 200) add `broadcastSessions();`.

In `dropServer()`, after the `if (wasActive) { ackPlugin(); }` block (line 127) and before `armIdleTimer();`, add `broadcastSessions();`.

- [ ] **Step 4: Handle `select_session` from the plugin**

In the "from the plugin" block, after the `server_request` handler (after line 230, before the final `return;` at 231), add:

```ts
        // The plugin picks which connected project to use for filesystem ops.
        if (msg.type === 'select_session' && typeof msg.sessionId === 'string') {
          if (servers.some((s) => s.sessionId === msg.sessionId)) {
            selectedSessionId = msg.sessionId;
            blog(`plugin selected session ${msg.sessionId}.`);
          }
          broadcastSessions();
          return;
        }
```

- [ ] **Step 5: Build**

Run: `cd claude-plugin/mcp && npm run build`
Expected: builds clean.

- [ ] **Step 6: Write the integration handshake test**

Create `claude-plugin/mcp/picker-handshake.test.mjs`:

```js
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

const PORT = 39922;
const bundle = new URL('./server.js', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { console.log('FAIL:', m); process.exit(1); };

const broker = spawn(process.execPath, [bundle, '--broker'], {
  env: { ...process.env, DESIGNAGENT_BRIDGE_PORT: String(PORT) },
  stdio: 'ignore'
});
await sleep(700);

function open(onMsg) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  ws.on('message', (d) => onMsg(JSON.parse(d.toString()), ws));
  return ws;
}
const waitOpen = (ws) => new Promise((res) => ws.on('open', () => res()));

// Fake plugin: collects the latest `sessions` payload and any relayed server_request.
let lastSessions = null;
const pluginGot = [];
const plugin = open((m) => {
  if (m.type === 'sessions') lastSessions = m.sessions;
});
await waitOpen(plugin);
plugin.send(JSON.stringify({ type: 'hello', role: 'figma-plugin' }));

// Fake server A (root /a) then B (root /b); B registers last → newest.
// IMPORTANT: send `register` ONLY on open (the real server.ts does the same).
// Re-sending on register_ack would loop register→ack→register forever.
function fakeServer(sessionId, root, label, onRequest) {
  const ws = open((m) => {
    if (m.type === 'server_request') onRequest(m);
  });
  ws.on('open', () => ws.send(JSON.stringify({ type: 'register', role: 'mcp-server', sessionId, root, label, version: 2 })));
  return ws;
}
const aGot = []; const bGot = [];
fakeServer('sess-a', '/a', 'proj-a', (m) => aGot.push(m));
await sleep(200);
const wsB = fakeServer('sess-b', '/b', 'proj-b', (m) => bGot.push(m));
await sleep(400);

// 1. sessions broadcast lists both, newest (B) marked selected.
if (!lastSessions || lastSessions.length !== 2) fail(`expected 2 sessions, got ${JSON.stringify(lastSessions)}`);
const bRow = lastSessions.find((s) => s.id === 'sess-b');
if (!bRow?.selected) fail(`expected newest (B) selected by default: ${JSON.stringify(lastSessions)}`);
if (lastSessions.find((s) => s.id === 'sess-a')?.root !== '/a') fail('session A root mismatch');
console.log('PASS: sessions broadcast lists both; newest selected by default');

// 2. default reverse-channel routing goes to newest (B).
plugin.send(JSON.stringify({ type: 'server_request', id: 'r1', command: 'list_html_files' }));
await sleep(250);
if (bGot.length !== 1 || aGot.length !== 0) fail(`default route should hit B, not A (a=${aGot.length} b=${bGot.length})`);
console.log('PASS: default reverse route → newest session');

// 3. select A → A marked selected, routing follows.
plugin.send(JSON.stringify({ type: 'select_session', sessionId: 'sess-a' }));
await sleep(250);
if (!lastSessions.find((s) => s.id === 'sess-a')?.selected) fail('A not marked selected after select_session');
plugin.send(JSON.stringify({ type: 'server_request', id: 'r2', command: 'list_html_files' }));
await sleep(250);
if (aGot.length !== 1) fail(`after select, route should hit A (a=${aGot.length})`);
console.log('PASS: select_session pins reverse route to chosen session');

// 4. reconnect dedupe: B re-registers with the same sessionId → no duplicate row.
wsB.send(JSON.stringify({ type: 'register', role: 'mcp-server', sessionId: 'sess-b', root: '/b', label: 'proj-b', version: 2 }));
await sleep(250);
if (lastSessions.filter((s) => s.id === 'sess-b').length !== 1) fail(`dedupe failed: ${JSON.stringify(lastSessions)}`);
console.log('PASS: re-register same sessionId does not duplicate the row');

console.log('ALL PICKER TESTS PASSED');
broker.kill();
process.exit(0);
```

- [ ] **Step 7: Run the integration test, expect PASS**

Run: `cd claude-plugin/mcp && node picker-handshake.test.mjs`
Expected: three `PASS:` lines then `ALL PICKER TESTS PASSED`.

- [ ] **Step 8: Remove the throwaway test + commit**

```bash
rm claude-plugin/mcp/picker-handshake.test.mjs
git add claude-plugin/mcp/src/broker.ts claude-plugin/mcp/server.js
git commit -m "feat(bridge): broker broadcasts session list and honors plugin select_session"
```

---

### Task 4: UI — session state, `sessions` handling, selection + refresh

Wire the broker's session list into the UI and add selection.

**Files:**
- Modify: `src/ui.tsx` (state near line 141; `onmessage` types line 337–343 and handlers near line 380; new `selectSession`; reset on disconnect near line 592)

- [ ] **Step 1: Add session state + type**

In `src/ui.tsx`, near the other `useState` calls (around line 141), add:

```tsx
  const [sessions, setSessions] = useState<Array<{ id: string; label: string; root: string; selected: boolean }>>([]);
  const [projectConfirmed, setProjectConfirmed] = useState<boolean>(false);
```

- [ ] **Step 2: Parse `sessions` in `onmessage`**

In the `onmessage` `msg` type (lines 337–343), add `sessions?: unknown;` and `sessionId?: string;`. Then, just after the `hello_ack` handler returns (after line 369), add:

```tsx
        if (msg.type === 'sessions' && Array.isArray(msg.sessions)) {
          const list = (msg.sessions as unknown[])
            .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
            .map((s) => ({
              id: String(s.id ?? ''),
              label: String(s.label ?? ''),
              root: String(s.root ?? ''),
              selected: Boolean(s.selected)
            }))
            .filter((s) => s.id);
          setSessions(list);
          return;
        }
```

- [ ] **Step 3: Add `selectSession` + auto-confirm/reset effects**

After `callServer` (after line 537), add:

```tsx
  // Pick which connected project the plugin reads/writes; refresh derived views.
  const selectSession = (sessionId: string) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'select_session', sessionId }));
    }
    setProjectConfirmed(true);
    void checkDesignMd();
  };
```

Near the existing connect/disconnect effect (around line 592), add a second effect:

```tsx
  // Auto-skip the picker gate when there's exactly one project; reset when the
  // bridge drops or all sessions leave.
  useEffect(() => {
    if (bridgeStatus !== 'connected' || sessions.length === 0) {
      setProjectConfirmed(false);
    } else if (sessions.length === 1) {
      setProjectConfirmed(true);
    }
  }, [bridgeStatus, sessions.length]);
```

Also re-run the DESIGN.md check when the selection changes — change the existing connect effect dependency (line ~599) so the derived root stays in sync; replace its body to key off the selected session:

```tsx
  useEffect(() => {
    if (bridgeStatus === 'connected') {
      void checkDesignMd();
    } else {
      setDesignMd({ checked: false, exists: false, root: '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridgeStatus, sessions.find((s) => s.selected)?.id]);
```

- [ ] **Step 4: Typecheck**

Run (repo root): `npm run typecheck`
Expected: no errors. (Render still uses the old layout — wired in Task 5. `selectSession`/`sessions`/`projectConfirmed` may be unused until then; if `noUnusedLocals` flags them, proceed directly to Task 5 in the same commit — see Task 5 Step 4.)

- [ ] **Step 5: Commit**

```bash
git add src/ui.tsx
git commit -m "feat(ui): track connected sessions + selection from the bridge"
```

---

### Task 5: UI — ProjectPicker component, gate + switcher, project-keyed refresh

Render the gate after connect and a compact switcher afterward; key the HTML browser to the selected project.

**Files:**
- Modify: `src/ui_components.tsx` (new `ProjectPicker`; `HtmlBrowser` gains `projectKey`)
- Modify: `src/ui.tsx` (render block lines 648–702; pass `projectKey` to `HtmlBrowser`)

- [ ] **Step 1: Add `ProjectPicker` to `ui_components.tsx`**

After `MainTabs` (after line 143), add:

```tsx
export interface SessionInfo {
  id: string;
  label: string;
  root: string;
  selected: boolean;
}

interface ProjectPickerProps {
  sessions: SessionInfo[];
  onSelect: (id: string) => void;
  variant: 'gate' | 'compact';
}

export function ProjectPicker({ sessions, onSelect, variant }: ProjectPickerProps): JSX.Element {
  if (variant === 'compact') {
    const current = sessions.find((s) => s.selected) ?? sessions[0];
    return (
      <div className="project-switch">
        <span className="project-switch-label">Project</span>
        <select
          className="project-switch-select"
          value={current?.id ?? ''}
          onChange={(e) => onSelect(e.target.value)}
          aria-label="Active project"
        >
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
    );
  }
  return (
    <div className="panel project-gate">
      <div className="section-subtitle" style={{ marginTop: 0 }}>
        Choose a project
      </div>
      <p className="bridge-explainer" style={{ marginTop: 6 }}>
        Several Claude sessions are connected. Pick which project DesignAgent reads & writes.
      </p>
      <div className="project-gate-list">
        {sessions.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`project-gate-item ${s.selected ? 'selected' : ''}`}
            onClick={() => onSelect(s.id)}
          >
            <span className="project-gate-name">{s.label}</span>
            <span className="project-gate-path">{s.root}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Give `HtmlBrowser` a `projectKey` so it re-lists on project change**

In `HtmlBrowserProps` (lines 297–301) add `projectKey?: string;`. In the `refresh` useCallback deps (line 323) and the effect (line 327), include `projectKey`:

```tsx
  const refresh = React.useCallback(async () => {
    if (!connected) return;
    setLoading(true);
    setStatus('');
    try {
      const result = await listFiles();
      setRoot(result.root);
      setFiles(result.files);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to list files');
    } finally {
      setLoading(false);
    }
  }, [connected, listFiles, projectKey]);
```

(The `useEffect(() => { void refresh(); }, [refresh])` already re-runs when `refresh` changes.)

- [ ] **Step 3: Wire the gate + switcher into `ui.tsx`**

Add `ProjectPicker` and `SessionInfo` to the import from `./ui_components` (top of `src/ui.tsx`).

Replace the render region from `<MainTabs ... />` through the closing of the tab content (lines 660–702) with:

```tsx
        {bridgeStatus === 'connected' && sessions.length >= 2 && !projectConfirmed ? (
          <ProjectPicker variant="gate" sessions={sessions} onSelect={selectSession} />
        ) : (
          <>
            <MainTabs active={mainTab} onChange={setMainTab} />
            {sessions.length >= 2 ? (
              <ProjectPicker variant="compact" sessions={sessions} onSelect={selectSession} />
            ) : null}

            {error ? (
              <div className="error">
                <span>{error}</span>
                {errorHelpLink ? (
                  <a href={errorHelpLink} target="_blank" rel="noreferrer">
                    What's this?
                  </a>
                ) : null}
              </div>
            ) : null}

            {mainTab === 'design-to-code' ? (
              analyzing ? (
                <LoadingPanel nodeName={analyzing.nodeName} nodeType={analyzing.nodeType} />
              ) : analysis.hasSelection ? (
                <ExportPanel
                  intentLabel={toIntentLabel(analysis.intent)}
                  selectedNodeName={analysis.selectedNode.name}
                  status={status}
                  bridgeConnected={bridgeStatus === 'connected'}
                  designChecked={designMd.checked}
                  designExists={designMd.exists}
                  designRoot={designMd.root}
                  onSyncDesignMd={syncDesignMd}
                  onApplyToFigma={applyToFigma}
                  onExportDesignMd={onExportDesignMd}
                  onExportHtml={onExportHtml}
                />
              ) : (
                <EmptyState message={analysis.message} />
              )
            ) : (
              <>
                <CapabilityView />
                <HtmlBrowser
                  connected={bridgeStatus === 'connected'}
                  listFiles={listHtmlFiles}
                  renderFile={renderHtmlFile}
                  projectKey={sessions.find((s) => s.selected)?.id}
                />
              </>
            )}
          </>
        )}
```

Note: the `error` block and tab content moved *inside* the else branch — confirm the original standalone `{error ? ...}` block (previously lines 662–671) is not duplicated.

- [ ] **Step 4: Add minimal styles**

In `src/ui_theme.ts`, append rules for the new classes (match existing token/spacing style):

```css
.project-gate-list { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.project-gate-item { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border, #e4e0d8); background: transparent; cursor: pointer; text-align: left; }
.project-gate-item.selected { border-color: var(--accent, #d97757); }
.project-gate-name { font-weight: 600; }
.project-gate-path { font-size: 11px; opacity: 0.6; }
.project-switch { display: flex; align-items: center; gap: 6px; padding: 4px 12px 0; font-size: 11px; }
.project-switch-label { opacity: 0.6; }
.project-switch-select { font: inherit; font-size: 11px; }
```

(Use the project's existing CSS-var names if they differ — check `ui_theme.ts` for the actual accent/border tokens and substitute.)

- [ ] **Step 5: Typecheck + build**

Run (repo root): `npm run typecheck` then `npm run build`
Expected: no type errors; `dist/ui.js` + `dist/code.js` written.

- [ ] **Step 6: Commit**

```bash
git add src/ui_components.tsx src/ui.tsx src/ui_theme.ts
git commit -m "feat(ui): project gate after connect + compact switcher; key HTML browser to project"
```

---

### Task 6: Shorten the plugin window (720 → 560)

**Files:**
- Modify: `src/code.ts` (lines 17–18)

- [ ] **Step 1: Change the height**

In `src/code.ts`, the `figma.showUI` size (lines 17–18) — change `height: 720` to `height: 560` (leave `width: 400`).

- [ ] **Step 2: Build**

Run (repo root): `npm run build`
Expected: builds clean.

- [ ] **Step 3: Commit**

```bash
git add src/code.ts
git commit -m "chore(ui): shorten plugin window to 560px tall"
```

---

### Task 7: Version bump + full verification

Bump all four version strings to `0.14.2` and verify end-to-end.

**Files:**
- Modify: `package.json` (`version`), `src/ui_components.tsx` (footer `version-tag`), `claude-plugin/.claude-plugin/plugin.json` (`version`), `.claude-plugin/marketplace.json` (`plugins[0].version`)

- [ ] **Step 1: Bump the four versions**

- `package.json`: `"version": "0.14.1"` → `"0.14.2"`
- `src/ui_components.tsx` footer: `v1.14.1` → `v1.14.2` (the `version-tag` span)
- `claude-plugin/.claude-plugin/plugin.json`: `"version": "0.14.1"` → `"0.14.2"`
- `.claude-plugin/marketplace.json`: `plugins[0].version` `"0.14.1"` → `"0.14.2"` (leave top-level `metadata.version`)

- [ ] **Step 2: Typecheck + both builds**

Run (repo root): `npm run typecheck && npm run build`
Then: `cd claude-plugin/mcp && npm run build`
Expected: all clean.

- [ ] **Step 3: Re-run the broker picker handshake test (regression)**

Re-create `claude-plugin/mcp/picker-handshake.test.mjs` from Task 3 Step 6, run it, confirm `ALL PICKER TESTS PASSED`, then `rm` it.

- [ ] **Step 4: Manual Figma verification**

Load/re-run the plugin in Figma (re-run the DesignAgent plugin to pick up the new build), enable the bridge, and confirm:
- **Single session:** gate auto-skips straight to the tabs; no picker gate shown.
- **Multi-session** (open a second Claude/Cursor session in another project): after connect, the gate lists both projects by label + path; selecting one shows the tabs.
- **Scan follows selection:** code→design "Scanning:" shows the selected project's root; the file list is that project's `.html` files.
- **DESIGN.md follows selection:** design→code card path shows `${selectedRoot}/DESIGN.md`; a Create/Update writes into the *selected* project's folder (verify the file appears there, not in the newest session's dir).
- **Switcher:** the compact "Project" control switches projects and the views update.
- **Height:** the window is shorter (560) and the gate + both tabs fit/scroll cleanly.

- [ ] **Step 5: Commit**

```bash
git add package.json src/ui_components.tsx claude-plugin/.claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "chore: bump bridge versions to 0.14.2 (project picker)"
```

---

## Notes for the implementer

- **Do not bump `BROKER_PROTOCOL_VERSION`.** New fields (`root`, `label`) and messages (`sessions`, `select_session`) are additive and optional; old peers ignore unknown types and default missing fields. This matches the 0.14.1 build-stamp change.
- **The forward channel and `hello_ack` pairing are untouched.** The picker only steers the reverse (filesystem) channel; the green dot still reflects newest-session pairing.
- **`server.js` is committed** (zero-install). Always `cd claude-plugin/mcp && npm run build` and commit `server.js` alongside `broker.ts`/`server.ts` edits.
- **Self-heal interaction:** after merging + updating the installed plugin, the running MCP server replaces the stale broker (0.14.1 build-stamp self-heal), so the new broker logic loads on restart.
