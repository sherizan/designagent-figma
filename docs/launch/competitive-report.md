# DesignAgent — Competitive Report

*Plugin v0.14.13 · Figma Community "Version 5" · June 2026*

## TL;DR

**DesignAgent is Claude Code's live, local, two-way bridge to Figma — and the only one of its
kind built around a shared `DESIGN.md` spec.** Over a WebSocket on `localhost` (no API token, no
paid seat, no cloud roundtrip), Claude can read your current selection, build and edit the canvas
in place, *see* the rendered result, and exchange a design-system-faithful `DESIGN.md` so a
designer in Figma and a developer in Claude Code work from one always-current source of truth.

The field is getting crowded — figma-console-mcp, figma-use/figma-cli, and Figma's own
write-to-canvas MCP all let an AI touch the canvas. What none of them do is treat the
**design↔code feedback loop** as the product: a curated tool surface, a portable spec contract,
and the vision + debug tools Claude actually needs to build, look, and correct without leaving the
terminal.

---

## What DesignAgent does

DesignAgent exposes **33 MCP tools** to Claude Code, grouped by what they unlock:

### Read — Claude understands the design
`status`, `get_spec`, `get_design_md`, `list_page_nodes`
→ **Benefit:** Claude reads the live selection — structure, fills, strokes, layout, text, and
resolved Figma variables — and can export it as a `DESIGN.md` spec your codebase builds from. No
re-export, no stale Figma link.

### Build & edit — Claude has hands on the canvas
5 create tools (`create_frame`, `create_text`, `create_rectangle`, `create_ellipse`,
`place_image`), 7 style tools (`set_fill`, `set_text_style`, `set_corner_radius`, `set_stroke`,
`set_shadow`, …), 7 layout tools (`move`, `resize`, `reparent`, `clone`, `group`, `ungroup`,
`delete`), plus `instantiate_component`, `batch`, and `html_to_design`.
→ **Benefit:** Claude builds and refines the design *in place* — including rendering an HTML
mockup straight into real, editable Figma layers — instead of handing back a screenshot or a
one-shot export.

### See & debug — Claude has eyes and a console
`take_screenshot`, `console_logs`
→ **Benefit:** Claude renders the canvas to a PNG and *looks* at its own work, then reads the
plugin's captured console to debug — closing the build → look → correct loop without a human
ferrying screenshots back and forth.

### Spec round-trip — one shared source of truth
`get_design_md` (Figma → spec) and the `DESIGN.md` apply path (spec → Figma tokens).
→ **Benefit:** `DESIGN.md` (token frontmatter + prose + designer notes) becomes the contract both
sides build from. Wire it into `CLAUDE.md` and it auto-loads every session. Design and code stop
drifting.

### Stay out of the way — intentional minimalism
Annotations (`annotate`), auto-layout repair (`apply_fix`), a multi-session project picker, and
Dev-Mode focus-follow round out the surface. The plugin panel itself does exactly two things:
**connect the bridge** and **pick the project**. Everything else is driven by Claude in the
terminal.

**Privacy by construction:** the plugin sandbox ships with `networkAccess: none`, and the bridge
runs entirely on a local WebSocket broker (`ws://localhost:3790`). No design data leaves your
machine.

---

## The landscape

**figma-console-mcp** *(southleft)* — A broad MCP server (106 tools in local mode) connecting
through a Desktop Bridge plugin over WebSocket, or through a **Cloud Mode relay** (Cloudflare
Durable Object), or a read-only remote SSE endpoint. Requires a Figma **Personal Access Token**.
Its strength is breadth: deep design-system token export (DTCG / CSS / Tailwind / SCSS / TS),
WCAG accessibility scanning, and FigJam / Slides authoring. It has no `DESIGN.md` spec concept.

**figma-use / figma-cli** *(dannote)* — A CLI (and optional MCP, 90+ tools / 100+ commands) that
drives Figma over the **Chrome DevTools Protocol** (`--remote-debugging-port=9222`), no plugin and
no API key, claiming ~100× the throughput of the plugin API via Figma's multiplayer protocol. The
trade-off: you must launch Figma with a remote-debugging flag (a daemon workaround is needed on
Figma 126+, which blocks it). It's imperative/JSX-first and exports JSX / PNG / Storybook. No
`DESIGN.md`, no spec contract, no first-class vision tool.

**Official Figma Dev Mode MCP — write-to-canvas (`use_figma`)** *(Figma, first-party)* — Figma's
own server can now create real frames, components, variants, variables, and auto-layout on the
canvas by executing Plugin API JS, and it is **genuinely design-system-aware** — it reuses the
file's existing components, variables, and modes rather than drawing isolated primitives. This is
the most direct overlap with DesignAgent's build surface, and it's first-party. Writing requires a
**Full seat** (Dev seats are read-only); it's **beta, free for now, and slated to become a
usage-based paid feature**. It's link/URL-based and cloud-leaning, with documented limits today:
20 KB output per call, no image/asset or GIF support, no custom fonts, and components must be
published manually before Code Connect resolves them. What it has no concept of is a portable
`DESIGN.md` — it manipulates the canvas directly rather than exchanging a spec artifact both the
design and the codebase build from.

**claude-talk-to-figma-mcp** *(arinspunk)* — The closest structural analogue: an MCP that reads,
analyzes, and modifies Figma through a plugin bridge. It establishes the two-way-bridge pattern;
DesignAgent's edge over it is the `DESIGN.md` spec contract, the vision + console debug tools, and
a deliberately curated tool surface.

---

## Comparison matrix

| | **DesignAgent** | **Figma Console MCP** | **figma-use / figma-cli** | **Official Figma MCP** | **claude-talk-to-figma** |
|---|---|---|---|---|---|
| **Connection model** | Local WS broker (`:3790`) via plugin | Plugin WS *or* cloud relay *or* remote SSE | Chrome DevTools Protocol (`:9222`) | Remote/link-based (cloud-leaning) | Local WS via plugin |
| **Local-only / privacy** | ✓ Always local; sandbox `networkAccess: none` | Local mode only; cloud/SSE route through relay | ✓ Local (CDP) | ✗ Cloud-leaning | ✓ Local |
| **Two-way (read + write)** | ✓ | ✓ (local & cloud modes) | ✓ | ✓ (write needs Full seat) | ✓ |
| **Vision (`take_screenshot`)** | ✓ Native | ✓ | ✗ (exports PNG, no agent-vision loop) | ✓ (screenshots) | Partial |
| **Console / debug access** | ✓ `console_logs` (sandbox + UI) | ✓ Real-time (local mode) | ✗ | ✗ | ✗ |
| **`DESIGN.md` spec contract** | ✓ Round-trip | ✗ | ✗ | ✗ | ✗ |
| **HTML → real Figma layers** | ✓ `html_to_design` | Send live web UI as layers | ✗ | ✗ | ✗ |
| **API key / token needed** | ✗ None | ✓ Figma PAT (or OAuth for cloud) | ✗ None | Figma account auth | ✗ None |
| **Seat / plan required** | None | None (PAT covers it) | None | **Full seat to write** | None |
| **Pricing** | Free | Free / self-host | Free / open source | Free in beta → **usage-based paid** | Free |
| **Tool count** | 33 (curated) | 106 local / 95 cloud / 9 SSE | 90+ MCP / 100+ CLI | First-party set | ~broad |
| **Multi-session / project picker** | ✓ Broker session registry | ✗ | ✗ | ✗ | ✗ |
| **Target workflow** | Claude Code ↔ Figma design↔code loop | Design-system ops + a11y at scale | Fast scripted/agentic canvas control | First-party design-to-code | General AI ↔ Figma editing |

*Cells reflect capabilities verified as of June 2026; mode-dependent behavior is noted in-cell
rather than flattened to ✓/✗.*

---

## Where DesignAgent wins / where others win

### DesignAgent wins when…
- **You want design and code to share one source of truth.** The `DESIGN.md` round-trip is unique
  here — no competitor has a portable spec contract that both Figma and the codebase build from.
- **Privacy and zero-config matter.** No API token, no paid seat, no cloud relay. It runs on
  `localhost` with the sandbox locked to `networkAccess: none`.
- **You need Claude to *see and self-correct.*** `take_screenshot` + `console_logs` give Claude a
  real build → look → debug loop that the CLI and first-party options don't.
- **You're already in Claude Code.** The whole product is shaped around that loop — a curated
  33-tool surface and a plugin panel that gets out of the way.

### Others win when…
- **figma-console-mcp** — you need exhaustive design-token export (DTCG/CSS/Tailwind/SCSS/TS),
  WCAG/accessibility scanning, or FigJam/Slides automation at scale. It is the breadth leader.
- **figma-use / figma-cli** — you want maximum raw throughput and a huge imperative command set
  for scripted batch edits, and you're comfortable running Figma with remote debugging enabled.
- **Official Figma MCP** — you want first-party durability and native component fidelity, you
  already pay for Full seats, and you accept the current beta limits (no images, no custom fonts,
  20 KB/call).

---

## Positioning statement

> **DesignAgent is the live, local bridge that gives Claude Code hands and eyes in Figma — the
> only one built around a shared `DESIGN.md` spec, so a designer in Figma and a developer in
> Claude Code work from one always-current source of truth.**
