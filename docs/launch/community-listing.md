# Figma Community listing — copy

Reference copy for the Figma "Publish" form (bridge-first positioning). Paste/adapt into the
Community listing fields. Keep in sync with `claude-plugin/.claude-plugin/plugin.json` and
`.claude-plugin/marketplace.json` descriptions.

## Name
DesignAgent

## Tagline (short, one line)
Claude Code's live bridge to Figma — read, build, and edit your designs with AI.

## Description (long)
DesignAgent gives Claude Code **hands and eyes inside Figma**. Connect the bridge and Claude can
see your current selection, build and edit the design right on the canvas, and exchange a
design-system-faithful **DESIGN.md** spec — so a designer in Figma and a developer in Claude Code
work from one shared, always-current source of truth.

**What you can do**
- **Let Claude work in your file** — create and edit frames, text, styles, components, Auto Layout,
  and more, driven from Claude Code.
- **Hand off a faithful spec** — export a `DESIGN.md` (tokens + components + layout + your notes)
  that Claude builds production UI from, mapped onto your project's own design system.
- **Apply tokens back to Figma** — turn a project's `DESIGN.md` into Figma variables and text styles.
- **See Claude's code in Figma** — render Claude's HTML into real layers to review it on the canvas.

**How to connect**
1. Install the DesignAgent companion for Claude Code (Claude Code marketplace: `designagent`).
2. In your terminal, open your project and run `claude`.
3. Open this plugin in Figma and click **Start** on the Claude bridge bar — the dot turns green.
4. Ask Claude for what you want. If you have several projects open, pick which one in the project
   picker.

**Privacy**
The plugin talks only to a local bridge on your own machine (`localhost`). It makes no other network
requests — no design data leaves your computer.

## Tags / search terms
figma, claude, claude code, ai, design to code, design systems, design tokens, codegen, mcp,
developer tools

## Network access reasoning (mirrors manifest.json `networkAccess.reasoning`)
Connects to the local DesignAgent bridge on localhost so Claude Code can read and edit your current
Figma selection. No data leaves your machine.
