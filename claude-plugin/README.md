# DesignAgent — Claude Code plugin

The Claude Code companion to the [DesignAgent Figma plugin](https://github.com/sherizan/designagent-figma).
DesignAgent (in Figma) exports a `DESIGN.md` spec; this plugin teaches Claude Code
to build production UI from it the design-system-faithful way.

## What's inside

- **`design-to-code` skill** — builds UI from a `DESIGN.md`: maps the spec's design
  tokens and components onto your project, builds mode-aware and accessible code,
  reuses components, and implements only what the design evidences. Auto-wires
  `@DESIGN.md` into your `CLAUDE.md` so the spec stays loaded each session.
- **`designagent` MCP server** — a live two-way bridge so Claude Code can read,
  fix, and create on the open Figma file:
  - read: `status`, `get_design_md`, `get_spec`, `get_score`, `list_issues`
  - act: `focus`, `select`, `annotate`, `apply_fix`
  - create: `create_frame`, `create_text`, `create_rectangle`, `create_ellipse`
  - style: `set_text`, `set_text_style` (size/weight/color/align), `set_fill`,
    `set_corner_radius`, `set_stroke`, `set_shadow` (create tools also take `fill`,
    `cornerRadius`, `stroke`/`strokeWeight`, `padding`, and — for text — `weight`/`align` inline)

  Tools appear as `mcp__plugin_designagent_designagent__<tool>`.

## Install

In Claude Code, add the marketplace and install the plugin:

```bash
/plugin marketplace add sherizan/designagent-figma
/plugin install designagent@designagent
```

(`sherizan/designagent-figma` is the GitHub repo that hosts the marketplace;
`designagent@designagent` is the plugin `designagent` from the `designagent`
marketplace.)

Once installed, the `design-to-code` skill triggers when a `DESIGN.md` is present
or you ask to build UI from a Figma design — or invoke it explicitly with
`/designagent:design-to-code`.

## Workflow (spec hand-off)

1. In Figma, select frames/sections in **DesignAgent** → **Export DESIGN.md**.
2. Drop `DESIGN.md` into your project root.
3. Ask Claude Code to build it — the skill maps tokens/components and writes the UI.

## Two-way bridge (live Figma access)

The plugin bundles the `designagent` MCP server (`mcp/server.js`), launched by Claude
Code over stdio. It opens a local WebSocket server on `ws://localhost:3790`; the
DesignAgent plugin's UI connects to it.

1. Open the **DesignAgent** plugin in Figma and click **Enable** on the "Claude bridge"
   bar — the dot turns green when connected.
2. In Claude Code, the bridge tools are available immediately (`status`,
   `get_design_md`, `get_score`, `focus`, `annotate`, `apply_fix`, …). Try: *"Use
   DesignAgent to check the readiness of my current Figma selection."*

Notes:
- Node must be installed (the server runs via `node`). The bundled `server.js` has no
  install step.
- Port is configurable with `DESIGNAGENT_BRIDGE_PORT` (default `3790`); it must match
  the plugin. The socket closes when the plugin window closes.
- `networkAccess` lists `ws://localhost:3790` — Figma's manifest validator rejects
  raw IPs (`127.0.0.1` → "must be a valid URL"), and its CSP needs the `ws` scheme
  listed explicitly (an `http` entry does not authorize the socket). So the server,
  plugin, and manifest all use the `localhost` host with the `ws` scheme.
- For the **published** Figma plugin, localhost must move from `devAllowedDomains` to
  `allowedDomains` (with a `reasoning` field) in `manifest.json`.
