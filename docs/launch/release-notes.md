# Release notes

## For the Figma Community publish form ("What's new")

Paste this (short, user-facing) into the release-notes field when publishing.

> **DesignAgent is now a live bridge to Claude Code.** Connect the bridge, pick which project to work
> in, and from your terminal Claude can read your current selection and build or edit the design right
> on the canvas — and turn it into a `DESIGN.md` spec your codebase builds from. The plugin panel
> stays simple (connect + pick project); you drive everything by asking Claude. It all runs over a
> local connection on your own machine — no design data leaves your computer.
>
> Get the companion for Claude Code, run `claude` in your project, then click **Start** on the
> bridge bar in this plugin.

## Changelog — 0.14.x (the launch line)

User-facing highlights of what shipped leading into launch:

- **Live two-way bridge.** Claude Code reads and edits the live Figma document over a local
  connection (~30 create/edit tools), with `DESIGN.md` as the shared design↔code contract.
- **Project picker.** With multiple Claude sessions/projects connected, choose which one the plugin
  reads and writes — no more guessing which project is active.
- **Reliable connection.** The bridge self-heals across plugin/CLI restarts and reconnects on its own.
- **Focused panel.** The plugin is just **connect the bridge + pick your project** — Claude drives
  everything else from your terminal. (The earlier in-panel export tabs are hidden for now while we
  redesign that surface.)
- **Privacy.** The plugin makes no network requests beyond the local bridge on your machine.

### Engineering notes (not for the listing)
- `0.14.1` build-stamp broker **self-heal** (a rebuilt server replaces a stale broker automatically).
- `0.14.2` **project picker** (broker session registry + `select_session` routing + UI gate/switcher).
- `0.14.3` declared the **bridge-first spine**; removed the unused design-quality **scoring engine**;
  realigned docs.
- `0.14.4` **production network access** — moved the localhost bridge into `manifest.json`
  `allowedDomains` so the *published* plugin can reach the bridge (was dev-only).
- `0.14.5` **hid the main tabs** behind `SHOW_MAIN_TABS` — launch UI = bridge + picker + connected hint.
- `0.14.6`–`0.14.7` shortened the panel window (→ 320px) to suit the reduced UI.
