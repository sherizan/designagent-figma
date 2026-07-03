# DesignAgent

**Claude Code's hands and eyes inside Figma.** A live, local two-way bridge: from your terminal,
Claude reads your current Figma selection, builds and edits the design directly on the canvas, sees
its own work with a screenshot, and exchanges a design-system-faithful `DESIGN.md` spec your
codebase builds from — so a designer in Figma and a developer in Claude Code work from one
always-current source of truth.

Runs entirely on `localhost` — no Figma API token, no cloud roundtrip, no design data leaving your
machine.

## 📚 Documentation

**Full docs, every tool, and guides live at [designagent.dev](https://designagent.dev).**

Figma plugin: [DesignAgent — Claude bridge](https://www.figma.com/community/plugin/1604428052675393154/designagent-claude-bridge) on Figma Community.

## Quick start

1. **Install the Figma plugin** from [Figma Community](https://www.figma.com/community/plugin/1604428052675393154/designagent-claude-bridge).
2. **Install the Claude Code plugin:**
   ```bash
   /plugin marketplace add sherizan/designagent
   /plugin install designagent@designagent
   ```
3. **Connect the bridge:** open the DesignAgent plugin in Figma and click **Start** on the Claude
   bridge bar — the dot turns green when connected.
4. In Claude Code, try: *"Use DesignAgent to read my current Figma selection and build it."*

See [designagent.dev](https://designagent.dev) for the full tool reference and workflows.

## How it works

DesignAgent is a Figma plugin plus a Claude Code plugin (skill + MCP server) that talk over a local
WebSocket broker on `ws://localhost:3790`. The Figma plugin sandbox ships with `networkAccess: none`
— the bridge is the only connection, and it never leaves your machine.

## Development

```bash
npm run build      # build the Figma plugin bundles → dist/
npm run watch      # rebuild on save
npm run typecheck  # the only static check
```

Load in Figma via **Plugins → Development → Import plugin from manifest…** → `manifest.json`.
