# Release notes

## For the Figma Community publish form ("What's new")

Paste this (short, user-facing) into the release-notes field when publishing.

> **DesignAgent is now a live bridge to Claude Code.** Connect the bridge and Claude can see your
> current selection, build and edit your design right on the canvas, and exchange a `DESIGN.md` spec
> with your codebase — so design and code stay in sync. Working across several projects? Pick which
> one Claude acts on. Everything runs over a local connection on your own machine; no design data
> leaves your computer.
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
- **Focused panel.** The plugin is now the bridge + project picker; Claude drives the rest from your
  terminal. (The older export tabs are temporarily hidden while we redesign that surface.)
- **Privacy.** The plugin makes no network requests beyond the local bridge on your machine.

### Engineering notes (not for the listing)
- `0.14.1` build-stamp broker **self-heal** (a rebuilt server replaces a stale broker automatically).
- `0.14.2` **project picker** (broker session registry + `select_session` routing + UI gate/switcher).
- `0.14.3` declared the **bridge-first spine**; removed the unused design-quality **scoring engine**;
  realigned docs.
- `0.14.4` **production network access** — moved the localhost bridge into `manifest.json`
  `allowedDomains` so the *published* plugin can reach the bridge (was dev-only).
- `0.14.5` **hid the main tabs** behind `SHOW_MAIN_TABS` — launch UI = bridge + picker + connected hint.
- `0.14.6` shortened the panel window to suit the reduced UI.
