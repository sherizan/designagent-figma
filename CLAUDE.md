# DesignAgent — Figma plugin

DesignAgent analyzes the current Figma selection (screen / component / section), scores its
design quality, and generates platform-specific, code-gen-ready prompts for SwiftUI (iOS),
Jetpack Compose (Android), React Native + Expo + NativeWind, Next.js + Tailwind + shadcn/ui,
and plain web HTML/CSS.

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
- **`src/ui.tsx`** — the **React 18 UI panel** (560×760). Has the DOM, no Figma API. Renders
  analysis results and sends user actions back to the sandbox. Entry → `dist/ui.html`
  (build inlines `dist/ui.js` into the HTML template `src/ui.html`).
- **`src/shared/messages.ts`** — the message contract between the two. Add/extend message types
  here first, then handle them on both sides. UI→Plugin: `SET_PRESET`, `SET_MODE`,
  `SET_FIGMA_LINK_BASE`, `FOCUS_NODE`, `ADD_ANNOTATION`, `REFRESH_REQUEST`. Plugin→UI:
  `ANALYSIS_STARTED`, `ANALYSIS_RESULT`, `ISSUE_FIX_RESULT`, `ERROR`.

### Analysis engine — `src/core/`

Orchestrated by `analyze.ts` (`analyzeNodeCoreAsync`, caching, link building). Pipeline:

1. **`extract.ts`** — Figma node tree → UI spec (fills, strokes, layout, text, tokens, annotations).
2. **`intent.ts`** — classify selection as screen / component / section (size + name heuristics).
3. **`score.ts`** — design quality score across 5 weighted dimensions (component coverage 30,
   tokenization 25, layout semantics 20, naming 15, variant completeness 10) + checklist/issues.
4. **`prompt.ts`** — compose the platform-specific code-gen prompt for the active preset.

Shared types live in `src/core/types.ts`. Presets are defined there too (default: `swiftui-ios`).

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
> live two-way bridge — it talks to the running DesignAgent plugin over a local WebSocket
> (`ws://localhost:3790`) to read and manipulate the *design*. It deliberately has **no**
> plugin-reload, screenshot, or console-log tools, so reloading a fresh build and eyeballing
> the UI are manual steps in Figma. Because DesignAgent is both the plugin under development
> *and* the bridge host, re-running it drops and re-establishes the bridge.

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
4. To load a fresh build, **re-run the DesignAgent plugin** in Figma (there's no programmatic
   reload); the bridge reconnects on its own. Verify the UI visually in the panel.

Use the **`/reload`** slash command to run build → check the bridge → report what the rebuilt
plugin sees for the current selection.

## Useful skills / MCP (already available)

- **frontend-design** skill — when building/refining the React panel UI.
- **context7** MCP — fetch current React / Figma Plugin API docs (prefer over memory).
- **superpowers** skills — `brainstorming` (before new features), `systematic-debugging`,
  `test-driven-development` for non-trivial logic in `src/core/`.
