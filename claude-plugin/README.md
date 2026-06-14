# DesignAgent — Claude Code plugin

The Claude Code companion to the [DesignAgent Figma plugin](https://github.com/sherizan/designagent-figma).
DesignAgent (in Figma) exports a `DESIGN.md` spec; this plugin teaches Claude Code
to build production UI from it the design-system-faithful way.

## What's inside

- **`design-to-code` skill** — builds UI from a `DESIGN.md`: maps the spec's design
  tokens and components onto your project, builds mode-aware and accessible code,
  reuses components, and implements only what the design evidences. Auto-wires
  `@DESIGN.md` into your `CLAUDE.md` so the spec stays loaded each session.

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

## Workflow

1. In Figma, select frames/sections in **DesignAgent** → **Export DESIGN.md**.
2. Drop `DESIGN.md` into your project root.
3. Ask Claude Code to build it — the skill maps tokens/components and writes the UI.
