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
3. **Connect the bridge:** run `claude` inside your project folder, then open the DesignAgent
   plugin in Figma. It connects on its own; the dot turns green when connected.
4. In Claude Code, try: *"Use DesignAgent to read my current Figma selection and build it."*

### Chat inside Figma (beta)

You can also type to Claude in the DesignAgent panel instead of the terminal. The panel runs your
own Claude Code headless in the selected project, so it uses the login you already have.

- **Pair once.** The panel shows a command that copies a pairing code from
  `~/.designagent-chat-code`; paste it into the panel. The command is macOS-only for now.
- **Files stay in the project.** Chat can read, and with "Let Claude edit my files" ticked, edit
  files inside the project folder only. It has no shell or web access, and cannot write tool or
  editor configuration (`.claude`, `.git`, `.vscode`, `.mcp.json` and similar).
- **Claude's cursor.** While a chat turn runs, a small "Claude" cursor layer moves across the canvas
  to what it is changing. It is removed when the turn ends.
- One Claude Code session must be open for the project, so the bridge knows the folder.

See [designagent.dev](https://designagent.dev) for the full tool reference and workflows.

## How it works

DesignAgent is a Figma plugin plus a Claude Code plugin (skill + MCP server) that talk over a local
WebSocket broker on `ws://localhost:3790`. The Figma plugin sandbox ships with `networkAccess: none`
— the bridge is the only connection, and your design data never leaves your machine.

## Telemetry

The MCP server (the Claude Code side, not the Figma plugin) sends anonymous usage counts to
`designagent.dev` so we know which bridge tools are actually used. Each batch contains only:
tool names with call counts, the plugin version, and a random install id (a UUID stored in
`~/.designagent-id`). It never includes tool parameters, node names, file names, or any design
content. Failed calls are counted the same way under `<tool>_err` and similar suffixes, and
operations run inside `batch` under `b_<tool>` (still just the name of a built-in tool, never
the error text or anything you typed). A message sent from the in-panel chat is counted as
`chat_turn`: the count only, never the message. Opt out by setting `DESIGNAGENT_TELEMETRY=0` in your environment.

## Development

```bash
npm run build      # build the Figma plugin bundles → dist/
npm run watch      # rebuild on save
npm run typecheck  # the only static check
```

Load in Figma via **Plugins → Development → Import plugin from manifest…** → `manifest.json`.
