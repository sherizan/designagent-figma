# designreview — Claude Code plugin

AI design review inside Claude Code. Reviews **intent, not pixels** — connecting
your PRD, research, Figma, analytics, and content to surface the gaps that slip
through to handoff or launch. When there's a PRD but no design yet, it scaffolds
a starting point.

Figma is read and annotated through the **[DesignAgent](https://designagent.dev)
bridge** — no Figma token, no third-party MCP.

## Install

DesignReview and the DesignAgent bridge ship from the same marketplace — add it once,
install both:

```
/plugin marketplace add sherizan/designagent
/plugin install designagent@designagent     # the Figma bridge (read + annotate)
/plugin install designreview@designagent     # this plugin
```

The review reads and annotates the *open* Figma file via DesignAgent's MCP
(`mcp__plugin_designagent_designagent__*`), so open your file with the DesignAgent
Figma plugin (bridge enabled) before a review. Without the bridge live, `/review`
still runs against the `figma.md` text (and the optional read-only Figma Dev Mode
MCP) and says live inspection was skipped.

## Use

```
/new "Project Name"     scaffold projects/<slug>/{context,insights,memory}
/review <slug>          run the multi-agent review (or scaffold from the PRD)
/annotate <slug>        pin the findings into Figma as DesignAgent annotations
```

`/review` orchestrates a panel of agents (PRD, UX, Figma, content, analytics,
screen-planner) and writes a self-contained HTML review plus a Figma-ready
comments preview. In scaffold mode (a PRD but no Figma yet) it hands off a
**Figma Make** prompt per flow as an "Open in Figma Make" deep link. The full
review rules live in the bundled `design-review` skill.

## What's bundled

```
claude-plugin/
├── .claude-plugin/plugin.json
├── .mcp.json                        optional read-only Figma Dev Mode MCP (fallback)
├── commands/
│   ├── new.md                       /new  — scaffold a project
│   ├── review.md                    /review — the orchestrator
│   └── annotate.md                  /annotate — pin findings as DesignAgent annotations
├── agents/*.md                      6 specialist agents (5 review + screen-planner)
├── skills/design-review/SKILL.md    the review rubric (intent, states, guardrails)
└── templates/                       context stubs + HTML report + comments + Figma Make handoff
```

## Project layout

`/new` creates the DesignReview project convention — `projects/<slug>/context/*`
(prd, research, figma, analytics, content, DESIGN.md) plus `insights/` and `memory/`.
The per-project `DESIGN.md` is the review **rubric** ("what good means"); edit it to
your team's principles. (Note: this is unrelated to DesignAgent's `get_design_md`
build-spec export, which happens to share the filename.)

## License

MIT.
