# Figma Community listing — copy

Reference copy for the Figma "Publish" form (bridge-first positioning). Paste/adapt into the
Community listing fields. Keep in sync with `claude-plugin/.claude-plugin/plugin.json` and
`.claude-plugin/marketplace.json` descriptions.

## Name

DesignAgent

## Tagline (short, one line)

Claude Code's live bridge to Figma — read, build, and edit your designs with AI.

## Description (long)

DesignAgent connects **Claude Code to your Figma file** — a live bridge that gives Claude hands and
eyes on the canvas. From your terminal, Claude can read your current selection and build or edit the
design in place, and turn it into a design-system-faithful `DESIGN.md` spec your codebase can build
from. Design and code, one shared source of truth.

The plugin panel itself is intentionally simple: **connect the bridge, and pick which project Claude
works in.** Everything else happens in Claude Code — just ask.

**From Claude Code, you can**

- **Read the design** — Claude inspects your current selection: structure, tokens, text, and layout.
- **Build & edit on the canvas** — create and change frames, text, styles, components, and Auto
  Layout, driven by what you ask for in the terminal.
- **Get a faithful spec** — produce a `DESIGN.md` (tokens + components + layout) that Claude builds
  production UI from, mapped onto your project's own design system.

**How to connect**

1. Install the DesignAgent companion for Claude Code (Claude Code marketplace: `designagent`).
2. In your terminal, open your project and run `claude`.
3. Open this plugin in Figma and click **Start** on the Claude bridge bar — the dot turns green.
4. If you have several projects open, pick which one in the project picker. Then ask Claude.

**Privacy**
The plugin talks only to a local bridge on your own machine (`localhost`). It makes no other network
requests — no design data leaves your computer.

## Tags / search terms

figma, claude, claude code, ai, design to code, design systems, design tokens, codegen, mcp, developer tools

## Network access reasoning (mirrors manifest.json `networkAccess.reasoning`)

Connects to the local DesignAgent bridge on localhost so Claude Code can read and edit your current
Figma selection. No data leaves your machine.