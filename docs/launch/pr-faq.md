# DesignAgent — PR FAQ

*Working-backwards launch document · Plugin v0.14.13 ("Version 5") · June 2026*

---

## Press release

### DesignAgent gives Claude Code hands and eyes in Figma

**A live, local, two-way bridge lets Claude read your Figma selection, build and edit the canvas
in place, and exchange a design-system-faithful `DESIGN.md` — so design and code finally share one
source of truth.**

Designers and developers have never been further apart than at the moment a design becomes code.
The handoff is a one-way export: a screenshot, a link, a spec that's stale the moment someone
nudges a frame. AI coding agents made it worse — they could *read* a Figma file, but they couldn't
see what they built, couldn't fix the design when it was wrong, and had no shared contract to keep
the two sides in sync.

DesignAgent closes the loop. It's a Figma plugin paired with a Claude Code plugin that opens a
live bridge over a local WebSocket. From the terminal, Claude can read your current selection,
build and edit the design directly on the canvas, render its work to a screenshot and *look* at
it, read the plugin's console to debug, and turn the whole thing into a `DESIGN.md` spec your
codebase builds from — and back again.

"The pitch is simple: Claude's hands and eyes in Figma," said the maker of DesignAgent. "A
designer selects a frame; a developer asks Claude to build it — or fix it — and it happens live,
on the same canvas, from one shared spec. No tokens, no paid seats, no cloud roundtrip. Nothing
leaves your machine."

Under the hood, a persistent broker daemon on `ws://localhost:3790` relays 33 curated MCP tools
between Claude Code and the running plugin. The plugin sandbox ships with network access disabled,
so the entire exchange stays on your computer. The plugin panel does exactly two things — connect
the bridge and pick which project — and Claude drives everything else.

DesignAgent is **free** and available now. Designers install it in one click from the Figma
Community; developers add it to Claude Code from the `sherizan/designagent-figma` marketplace.
Click **Start**, wait for the green dot, and ask Claude to read your selection.

> Figma Community: https://www.figma.com/community/plugin/1604428052675393154/designagent-claude-bridge

---

## Internal FAQ

**Q: Figma's own MCP server can now write to the canvas. Why does DesignAgent still matter?**
The official `use_figma` write-to-canvas is first-party and durable, but it's a different product:
writing requires a **Full seat**, it's in beta and slated to become a **usage-based paid**
feature, it's cloud-leaning/link-based, and it has hard limits today (20 KB output per call, no
image/asset support, no custom fonts). DesignAgent is free, local-only, needs no seat or token,
handles images and `html_to_design`, and — critically — is built around the `DESIGN.md` spec
contract that no competitor has. We're not competing on "can an agent touch the canvas." We're
competing on the *design↔code feedback loop* as a whole product.

**Q: Why a local-only WebSocket instead of a cloud relay or a Figma API token?**
Three reasons: privacy, friction, and trust. The sandbox runs with `networkAccess: none`, and the
bridge never leaves `localhost`, so no design data goes to a third party — an easy "yes" for teams
with sensitive work. There's no Personal Access Token to mint and rotate, and no cloud account to
provision. The persistent broker on port 3790 also lets multiple Claude Code sessions share one
plugin connection cleanly.

**Q: Why invent a `DESIGN.md` spec at all? Why not just read the Figma file directly?**
Because a live read is a snapshot; a spec is a contract. `DESIGN.md` (token frontmatter + prose +
designer notes) is portable, diff-able, reviewable, and can be wired into `CLAUDE.md` so it
auto-loads every session. It's what keeps the designer's Figma and the developer's codebase from
drifting — and it round-trips both ways. It's the durable artifact competitors don't have.

**Q: As Figma ships more first-party AI features, what's our moat?**
The loop, not any single tool. (1) The `DESIGN.md` spec contract and the design-to-code skill that
consumes it. (2) Vision + console debugging (`take_screenshot` + `console_logs`) that let Claude
self-correct. (3) Local-first, zero-auth, free positioning. (4) A curated 33-tool surface tuned for
Claude Code specifically, rather than a sprawling generic API. First-party features raise the floor
for everyone; our value is being the best *Claude Code ↔ Figma* experience.

**Q: How do we measure success?**
Installs and weekly active bridges (Figma Community + Claude marketplace), bridge connection
success rate (green-dot-on-first-try), and the quality of `html_to_design` / build operations
against the supported-CSS subset — the I1–I7 issues from the live-user evaluation are the bar we
hold ourselves to.

**Q: What are the known limitations we should be honest about?**
- `html_to_design` is reliable only within a documented CSS subset (vertical flex columns, solid
  fills, borders, radius, shadows, Google Fonts); see `docs/DESIGNAGENT-EVALUATION.md`. Gradients,
  inline styled text runs, and negative-margin overlaps are now handled (I2/I4/I5) but exact-fit
  flex rows still need care.
- Fonts must already exist in the Figma file for text rendering.
- There's no programmatic plugin reload — loading a fresh build is a manual re-run in Figma (the
  bridge auto-reconnects).
- Large pages should be rendered section-by-section to stay under the bridge timeout.

**Q: What's next on the roadmap?**
Continued bridge-quality hardening and the WebSocket roadmap tracked in the product-direction
notes — deepening the live two-way reliability that is the product's spine, and broadening the
`DESIGN.md` round-trip fidelity.

---

## External / customer FAQ

**Q: What is DesignAgent?**
A live bridge between Claude Code and Figma. From your terminal, Claude can read your current Figma
selection, build and edit the design directly on the canvas, take a screenshot to see its work,
and exchange a `DESIGN.md` spec your codebase builds from — all over a local connection.

**Q: How is it different from figma-console-mcp?**
figma-console-mcp is broad and powerful for design-system operations (token export, accessibility
scanning, FigJam/Slides), but it needs a Figma Personal Access Token, can route through a cloud
relay, and has no shared-spec concept. DesignAgent needs no token, stays entirely local, and is
built around the `DESIGN.md` contract and the Claude Code build → look → debug loop.

**Q: How is it different from figma-cli / figma-use?**
figma-use drives Figma over the Chrome DevTools Protocol — very fast, with a huge command set — but
you must launch Figma with a remote-debugging flag (blocked on Figma 126+ without a workaround), and
it has no `DESIGN.md` spec or agent-vision loop. DesignAgent connects through a normal Figma plugin,
needs no debug flags, and gives Claude a screenshot + console to self-correct.

**Q: How is it different from the official Figma MCP write-to-canvas?**
Figma's own server is first-party but requires a **Full seat** to write, is in beta and becoming a
**paid** feature, and has current limits (no images, no custom fonts, 20 KB/call). DesignAgent is
free, needs no special seat, supports images and HTML-to-canvas, and adds the shared `DESIGN.md`
spec.

**Q: Does my design data leave my computer?**
No. The plugin sandbox runs with network access disabled, and the bridge runs entirely on a local
WebSocket (`ws://localhost:3790`). Nothing is sent to a third-party server.

**Q: Do I need a Figma API token or a paid Figma seat?**
No to both. There's no token to create and no Full/Dev seat requirement — the bridge works through
the plugin on a local connection.

**Q: Is it free?**
Yes. Both the Figma plugin and the Claude Code plugin are free.

**Q: How do I install it?**
Two sides, a couple of minutes:
1. **Designer (Figma):** Install DesignAgent from the
   [Figma Community](https://www.figma.com/community/plugin/1604428052675393154/designagent-claude-bridge)
   and open it.
2. **Developer (Claude Code):**
   ```
   /plugin marketplace add sherizan/designagent-figma
   /plugin install designagent@designagent
   ```
3. In the plugin panel, click **Start** on the Claude bridge bar — the dot turns green when
   connected. Then ask Claude: *"Use DesignAgent to read my current Figma selection."*

**Q: What can Claude actually do to my Figma file?**
Read your selection and the page structure; create frames, text, shapes, and images; style and
lay out nodes; instantiate components; render HTML into real layers; add annotations; and apply
auto-layout fixes. It can also take screenshots and read the plugin console to check and correct
its own work. You stay in control — you see every change happen live on the canvas.

**Q: What happens if the bridge disconnects?**
The broker daemon is persistent and the plugin reconnects on its own. If you load a fresh plugin
build, just re-run the plugin in Figma — the bridge reconnects automatically.

**Q: Does it work in Figma Dev Mode?**
Yes. In Dev Mode, the plugin follows the focused node in the inspector, so Claude can read what
you're inspecting even without an explicit selection.
