# DesignAgent — Figma plugin

DesignAgent is the **live bridge that gives Claude Code hands and eyes inside Figma**. Over a
local WebSocket, Claude can read the current selection, build and edit the design in place (~30
create/edit tools), and exchange a design-system-faithful `DESIGN.md` spec — so a designer in
Figma and a developer in Claude Code work from one shared, always-current source of truth. The
plugin panel surfaces the bridge (connect, project picker) and the `DESIGN.md` / HTML round-trip;
Claude drives the rest through the MCP tools.

Published: https://www.figma.com/community/plugin/1604428052675393154/designagent

## Commands

```bash
npm run build      # esbuild production bundles → dist/ (then run /reload in Figma)
npm run watch      # esbuild watch mode, rebuilds on save
npm run typecheck  # tsc --noEmit — the ONLY static check (no eslint/prettier, no tests)
```

Always run `npm run typecheck` before considering a change done.

## Architecture (two-process model)

Figma plugins run in two isolated contexts that talk over typed `postMessage`:

- **`src/code.ts`** — the **plugin sandbox**. Has the Figma API (`figma.*`), handles selection/
  focus events, annotations, and auto-layout fixes. No DOM. Entry → `dist/code.js`.
- **`src/ui.tsx`** — the **React 18 UI panel** (400×560). Has the DOM, no Figma API. Owns the
  WebSocket to the bridge broker, renders the connected state / project picker / DESIGN.md + HTML
  flows, and relays bridge commands to the sandbox. Entry → `dist/ui.html` (build inlines
  `dist/ui.js` into the HTML template `src/ui.html`).
- **`src/shared/messages.ts`** — the message contract between the two. Add/extend message types
  here first, then handle them on both sides. UI→Plugin includes `SET_MODE`, `SET_FIGMA_LINK_BASE`,
  `FOCUS_NODE`, `ADD_ANNOTATION`, `EXPORT_DESIGN_MD`, `EXPORT_HTML`, `APPLY_DESIGN_MD`,
  `BRIDGE_COMMAND`, `CREATE_DESIGN_TREE`, `REFRESH_REQUEST`. Plugin→UI includes `ANALYSIS_RESULT`,
  `DESIGN_MD_RESULT`, `HTML_RESULT`, `BRIDGE_RESULT`, `APPLY_DESIGN_MD_RESULT`, `ERROR`.

### Core engine — `src/core/`

Turns the live Figma selection into a portable spec. Orchestrated by `analyze.ts`
(`analyzeNodeCoreAsync`):

1. **`extract.ts`** — Figma node tree → `UiSpec` (fills, strokes, layout, text, tokens, annotations).
2. **`intent.ts`** — classify selection as screen / component / section (size + name heuristics).
3. **`designdoc.ts`** + **`serialize.ts`** — synthesize the `DESIGN.md` export (token frontmatter +
   prose + designer notes). This is the primary artifact Claude builds from (via the design-to-code skill).
4. **`parsedesignmd.ts`** — parse a project's `DESIGN.md` back into tokens for the "Apply to Figma" flow.

Shared types live in `src/core/types.ts`. The bridge tool surface (read + ~30 create/edit tools)
lives in the sandbox (`src/code.ts`) and is exposed to Claude by the MCP server (`claude-plugin/mcp/`).

### UI layer
`src/ui.tsx` (root) + `src/ui_components.tsx` (component library) + `src/ui_theme.ts`
(CSS-in-JS). Match the existing style/structure in these files when adding UI.

## Conventions

- TypeScript strict mode + `noUncheckedIndexedAccess`; JSX is `react-jsx`. Target es2015.
- Minimal deps: `react`, `react-dom`, `lucide-react` only. Don't add deps casually.
- `dist/` and `node_modules/` are gitignored — never commit build output.
- Plugin has `networkAccess: none` — the sandbox cannot make network calls.

## Versioning

Four version strings, **all bumped together** (keep them identical to avoid the Figma plugin
and the Claude plugin drifting apart):
- Figma plugin version → `package.json` `version`
- UI version tag → hardcoded in `src/ui_components.tsx` (the `version-tag` div in the footer)
- Claude plugin bundle → `claude-plugin/.claude-plugin/plugin.json` `version`
- Claude marketplace entry → `.claude-plugin/marketplace.json` `plugins[0].version`
  (the top-level `metadata.version` there is the catalog's own version — leave it)

The UI tag uses a `v1.x.y` form; the three JSON versions use `0.x.y` and should match each
other. Even when a change only touches one side, bump all four so installed versions stay in sync.

## Testing in Figma (designagent MCP bridge)

There are no automated tests — verification is visual, in Figma Desktop.

> **Note:** the **designagent** MCP server is part of *this* repo (`claude-plugin/mcp/`). It's a
> live two-way bridge — it talks to the running DesignAgent plugin over a local WebSocket (via a
> persistent broker daemon on `ws://localhost:3790`) to read and manipulate the *design*. It can
> `take_screenshot` (see the rendered design) and `console_logs` (read the plugin's captured
> console), but there is **no programmatic plugin-reload** — Figma exposes no API to reload a
> plugin's own code, so loading a fresh build is a manual re-run in Figma.

1. Build: `npm run build` (or keep `npm run watch` running).
2. Load DesignAgent via **Plugins → Development → Import plugin from manifest…** → repo-root
   `manifest.json` (first time only; after that just re-run it).
3. In the DesignAgent panel, click **Enable** on the "Claude bridge" bar — the dot turns green
   when the MCP is connected. Then use the designagent MCP tools (all prefixed
   `mcp__plugin_designagent_designagent__`):
   - `status` — confirm the bridge; see the file / page / current selection
   - `get_spec`, `get_score`, `get_design_md`, `list_issues` — inspect what the plugin extracts
   - `focus` / `select` — drive the Figma selection
   - `annotate`, `apply_fix`, plus the create/style/layout tools — act on the design
   - `take_screenshot` — render the selection/page to a PNG you can see; `console_logs` — read the
     plugin's captured console (sandbox + UI) for debugging
4. To load a fresh build, **re-run the DesignAgent plugin** in Figma (there's no programmatic
   reload); the bridge reconnects on its own. Verify the UI with `take_screenshot`.

Use the **`/reload`** slash command to run build → check the bridge → report what the rebuilt
plugin sees for the current selection.

## Useful skills / MCP (already available)

- **frontend-design** skill — when building/refining the React panel UI.
- **context7** MCP — fetch current React / Figma Plugin API docs (prefer over memory).
- **superpowers** skills — `brainstorming` (before new features), `systematic-debugging`,
  `test-driven-development` for non-trivial logic in `src/core/`.
