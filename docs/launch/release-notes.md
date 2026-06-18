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

> _Latest published release: **Figma Community "Version 5"** (2026-06-17) = plugin **0.14.13**. Figma's
> release counter is independent of our `0.14.x` version; they map 1:1 at publish time._

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
- **Sharper HTML→Figma rendering** (Version 5 / 0.14.13). Builds Claude sends to the canvas now keep
  CSS gradients, flex sizing, inline colored/bold words, and overlapping elements — and render more
  reliably — so what Claude builds matches what you'd expect.

### Engineering notes (not for the listing)
- `0.14.1` build-stamp broker **self-heal** (a rebuilt server replaces a stale broker automatically).
- `0.14.2` **project picker** (broker session registry + `select_session` routing + UI gate/switcher).
- `0.14.3` declared the **bridge-first spine**; removed the unused design-quality **scoring engine**;
  realigned docs.
- `0.14.4` **production network access** — moved the localhost bridge into `manifest.json`
  `allowedDomains` so the *published* plugin can reach the bridge (was dev-only).
- `0.14.5` **hid the main tabs** behind `SHOW_MAIN_TABS` — launch UI = bridge + picker + connected hint.
- `0.14.6`–`0.14.7` shortened the panel window (→ 320px) to suit the reduced UI.
- `0.14.8`–`0.14.13` **bridge-quality remediation** from a live-user eval (`docs/DESIGNAGENT-EVALUATION.md`),
  all in the HTML→Figma path: `0.14.8` published the supported-CSS subset; `0.14.9` render reliability
  (I3 — immediate root id + `replaceId` + `list_page_nodes`); `0.14.10` CSS gradients (I2);
  `0.14.11` flex exact-fit sizing (I1); `0.14.12` extraction fidelity (I6 fill/stroke hex, I7 spacing
  frequency-gate); `0.14.13` inline styled-text runs (I4) + negative-margin overlap (I5). The full
  eval (I1–I7) is addressed. **`0.14.13` is the published "Version 5" release.**
