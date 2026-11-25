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
  - read: `status`, `get_design_md`, `get_spec`
  - act: `focus`, `select`, `annotate`, `set_auto_layout`
  - create: `create_frame`, `create_text`, `create_rectangle`, `create_ellipse`,
    `place_image`
  - images: `place_image` (new node) / `set_image` (fill an existing node) — from a
    URL, local path, or base64; the server does the fetch/read, so no plugin network
    access is needed
  - style: `set_text`, `set_text_style` (size/weight/color/align), `set_fill`,
    `set_corner_radius`, `set_stroke`, `set_shadow` (create tools also take `fill`,
    `cornerRadius`, `stroke`/`strokeWeight`, `padding`, and — for text — `weight`/`align` inline)
  - layout: `move`, `resize`, `reparent`, `delete`
  - advanced: `clone`, `group`, `ungroup`, `set_opacity`, `set_rotation`,
    `instantiate_component`, `batch` (run many ops in one call)
  - design system: `list_variables_and_styles`, `bind_variable` (tie spacing, radius, type,
    colour and effect values to variables)
  - motion (Beta): `list_animation_styles`, `apply_animation`, `export_asset` with
    `format: "mp4" | "webm" | "gif"`
  - html → design: `html_to_design` — render HTML (a string or a project `.html` file
    path) into real Figma layers ("render index.html into Figma")

  Tools appear as `mcp__plugin_designagent_designagent__<tool>`.

## `html_to_design` — supported CSS subset (current fidelity)

`html_to_design` is powerful but has a known fidelity envelope. Staying inside it avoids silent
re-renders:

- **Reliable:** flex rows and columns (justify, gap, `flex-grow`, `flex-wrap`); px `min-`/`max-`
  sizes; CSS grid as a native Figma grid (`fr` tracks stay flexible, spans and `grid-area` keep
  their cells); absolutely positioned children; solid fills, linear and radial gradients,
  background images, `border`, `border-radius`, `box-shadow`, `backdrop-filter: blur()`; inline
  `<svg>` as vectors; Google fonts.
- **Known limits:** conic gradients flatten to their first stop; `flex-wrap: wrap-reverse` and
  grids offset by `justify-content` / `align-content` fall back to pinned or auto-flowed children;
  `auto-fill` / `auto-fit` and `auto` grid tracks become fixed px tracks; only fonts installed in
  Figma render.
- The tool's own description carries the full, current list.
- **Large pages:** render section-by-section — a very large single render can exceed the response
  timeout while the plugin keeps painting.

## Install

In Claude Code, add the marketplace and install the plugin:

```bash
/plugin marketplace add sherizan/designagent
/plugin install designagent@designagent
```

(`sherizan/designagent` is the GitHub repo that hosts the DesignAgent marketplace;
`designagent@designagent` is the plugin `designagent` from the `designagent`
marketplace.)

Once installed, the `design-to-code` skill triggers when a `DESIGN.md` is present
or you ask to build UI from a Figma design — or invoke it explicitly with
`/designagent:design-to-code`.

## Workflow (spec hand-off)

1. Connect the bridge (see below) and select the frames/sections in Figma.
2. Ask Claude to export them — it reads the selection (`get_design_md`) and writes `DESIGN.md`
   into your project.
3. Ask Claude Code to build it — the skill maps tokens/components and writes the UI.

## Two-way bridge (live Figma access)

The plugin bundles the `designagent` MCP server (`mcp/server.js`), launched by Claude
Code over stdio. It opens a local WebSocket server on `ws://localhost:3790`; the
DesignAgent plugin's UI connects to it.

1. Open the **DesignAgent** plugin in Figma. It connects on its own; the dot turns green
   when connected. (Stop and Reconnect are in the `⋯` menu.)
2. In Claude Code, the bridge tools are available immediately (`status`,
   `get_design_md`, `get_spec`, `focus`, `annotate`, `set_auto_layout`, …). Try: *"Use
   DesignAgent to read my current Figma selection and build it."*

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
