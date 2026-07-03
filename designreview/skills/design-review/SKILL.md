---
name: design-review
description: The DesignReview review rules — how to review design intent (not pixels) or scaffold from a PRD. Use when running a design review, checking PRD coverage, auditing the five states (happy/empty/loading/error/recovery), reviewing UX completeness, or proposing screens from a PRD. The /review command follows these rules.
---

# DesignReview Review Rules

**DesignReview reasons about intent, not pixels.** With a design, it *reviews* intent. With a PRD
but no design yet, it *scaffolds* a starting point from intent.

## Two modes

- **Review** (a Figma file is present in `figma.md`) — run the multi-agent design review below.
- **Scaffold** (a PRD but no Figma target in `figma.md`) — propose the screens from the PRD and hand
  off a **Figma Make** prompt per flow (surfaced as an "Open in Figma Make" deep link) so the
  designer generates a first-draft prototype from intent. Still intent-first — every proposed screen
  traces to a PRD step; this is a first draft to react to, not a finished, pixel-perfect design. The
  command selects the mode automatically by checking `figma.md` for a real Figma link/node.

## Review intent

Decide what kind of review to run before anything else — it routes what you check and how you
weight findings:

- **pre-handoff** — before engineering handoff. Weight flow clarity, the five states, and PRD
  coverage. Focus on what's missing or ambiguous, not launch-readiness.
- **pre-launch** — final gate. Weight analytics instrumentation, error/recovery states, edge
  cases, and trust signals. Surface launch-blocking gaps as P0.
- **gap-audit** — weight PRD-to-design coverage and missing states/edge cases. List every PRD
  requirement with no corresponding screen or state.

If the intent isn't given, infer it: sparse/early PRD + early Figma → pre-handoff; complete PRD
with analytics defined → pre-launch; a "what are we missing" framing → gap-audit. State the
intent you used at the top of the review.

## Reading & annotating Figma — the DesignAgent bridge

DesignReview reads and writes Figma through the **DesignAgent bridge** (the `designagent` plugin's
MCP, tools `mcp__plugin_designagent_designagent__*`). It reads the *currently-open* file, so the
designer keeps the DesignAgent Figma plugin open with the bridge live. Only the **figma-agent**
reads; only the **/annotate** command writes.

**Read (figma-agent):**

1. `status` — confirm the bridge is live and pointed at the right file (name, page, selection).
2. `list_page_nodes` — enumerate the page's top-level frames.
3. `get_spec` — structured hierarchy, tokens, layout, text, and **nested screen node IDs**.
4. `take_screenshot` — optional visual confirmation.
5. Use nested screen node IDs (not parent frames) so findings pin to specific screens.

**Annotate (/annotate command):** each posted finding becomes a DesignAgent **annotation** pinned to
its node — `annotate(nodeId, label, suggestion)` — capturing the design-intent gap on the frame
itself. No Figma token needed; the bridge auths through the open file.

**Fallback.** If the DesignAgent bridge isn't live, the read may use the optional official read-only
Figma Dev Mode MCP (`mcp__figma__*`). If neither is connected, **do not stop** — run the review
against the `figma.md` text (URLs, node IDs, screen notes) plus the PRD, research, analytics, and
content sources. Note that live Figma inspection was skipped and that screen-level node IDs are taken
from `figma.md` rather than verified. A review without Figma inspection is still more rigorous than
no review.

## File Access Contract

### READ ONLY
- `projects/<slug>/context/*` - User-provided context files (prd, research, figma, analytics, content, optional per-project DESIGN.md)
- `DESIGN.md` - Workspace-root design reference ("what good means"); the UX and content findings cite its rules. This is the review *rubric* — do NOT confuse it with, or overwrite it from, a DesignAgent `get_design_md` build spec.
- `${CLAUDE_PLUGIN_ROOT}/templates/*` - Output format templates bundled with the plugin

### WRITE ONLY
- `projects/<slug>/insights/*` - Generated review/scaffold outputs (incl. `screen-plan.md`, `run-manifest.json`)
- `projects/<slug>/insights/figma-make.html` - Scaffold Figma Make handoff (prompt-per-flow deep links)
- `projects/<slug>/memory/session.md` and `projects/<slug>/memory/project.md` - Updated after a run
  (do NOT write `user-preferences.md` — the designer owns it)

### DO NOT MODIFY
- `${CLAUDE_PLUGIN_ROOT}/*` - The plugin's own files (templates are read-only)
- `DESIGN.md` - the review rubric (the designer owns it)
- `package.json`
- `node_modules/`

## Output Files

Generate exactly two files:

### 1. design-review.html
**Follow the template:** `${CLAUDE_PLUGIN_ROOT}/templates/design-review.template.html` — a self-contained,
branded HTML report (this is the standard output). Copy it, keep the `<style>` intact, replace the
`{tokens}` and the example finding rows with real content, and remove any section that doesn't apply.
Every finding is framed as a question and carries its citation in `.src`.

Key sections:
- Executive Summary
- PRD Alignment (✅ Covered / ❓ Missing)
- States Review (per flow: Happy, Empty, Loading, Error, Recovery)
- Edge Cases (Offline, Permissions, Session, Accessibility, etc.)
- Research Findings Alignment
- Analytics Assumptions
- Recommendations (P0/P1/P2)
- Questions for Design Team

### 2. design-comments.preview.md
**IMPORTANT**: Follow the EXACT format in `${CLAUDE_PLUGIN_ROOT}/templates/design-comments.template.md`

- Use `## Comment N` headers
- Include all required fields: page, frame, nodeId, Type, Message, Why
- Limit to 10 most important comments
- These become DesignAgent annotations when the designer runs `/annotate <slug>` — every one needs a
  real screen-level `nodeId` to pin to.

## Review Checklists

### States (every screen)
- [ ] Happy path
- [ ] Empty state
- [ ] Loading state
- [ ] Error state
- [ ] Recovery path

### Edge Cases
- Offline behavior
- Permission denied
- Session timeout
- Rate limiting
- Accessibility

### PRD Alignment
- Does each PRD step have a screen?
- Are all goals addressed?
- Are edge cases covered?

### Content & Copy
- Do labels and CTAs match the content brief (`content.md`) and DESIGN.md voice?
- Are irreversible/high-stakes actions stated in plain language with their consequence?
- Does every error and empty state have microcopy and a recovery action?
- Is legal/compliance copy restated in plain English where required?

## Guardrails

These make the review trustworthy. Apply them to every finding before it ships:

1. **Input completeness.** If a context file is missing or still the empty template, flag it
   ("PRD is missing — this review is partial") rather than inventing requirements to fill the gap.
2. **Evidence or it doesn't ship.** Every finding cites its source — a PRD step, a research line,
   a DESIGN.md rule, an analytics number, or a Figma node. "This label is unclear" without a
   citation does not ship; "This label contradicts the plain-language rule in DESIGN.md §3" does.
3. **Questions, not verdicts.** Frame findings as questions ("Have you considered the empty state
   when the user has no transaction history?"), not commands ("Add an empty state").

## Tone

1. **Direct** — State observations clearly
2. **Question-based** — Frame gaps as questions
3. **Concise** — One idea per comment
4. **Actionable** — Suggest what to do
