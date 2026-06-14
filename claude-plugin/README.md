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

This plugin lives in the `claude-plugin/` directory of the DesignAgent repo. Until
it's published to a marketplace, install it from a local clone:

```bash
# From a project where you want to use it:
/plugin marketplace add /path/to/designagent-figma   # if a marketplace.json is added
# or copy the skill directly into your project:
cp -r /path/to/designagent-figma/claude-plugin/skills/design-to-code .claude/skills/
```

Once installed, the skill triggers automatically when a `DESIGN.md` is present or
you ask to build UI from a Figma design — or invoke it explicitly with
`/designagent:design-to-code`.

## Workflow

1. In Figma, select frames/sections in **DesignAgent** → **Export DESIGN.md**.
2. Drop `DESIGN.md` into your project root.
3. Ask Claude Code to build it — the skill maps tokens/components and writes the UI.
