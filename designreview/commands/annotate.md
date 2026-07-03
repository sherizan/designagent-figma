---
description: Pin a review's findings into Figma as DesignAgent annotations (reads design-comments.preview.md)
argument-hint: <project-slug> [--dry-run]
allowed-tools: Read, Write, Glob, mcp__plugin_designagent_designagent__status, mcp__plugin_designagent_designagent__list_page_nodes, mcp__plugin_designagent_designagent__annotate
---

# Annotate: $ARGUMENTS

Take the review's `design-comments.preview.md` for project `$1` and pin each finding into Figma as a
**DesignAgent annotation**, then record the designer's accept/override/dismiss decisions so the next
review learns from them. `--dry-run` prints the plan without touching Figma.

## 1. Read and parse

Read `projects/$1/insights/design-comments.preview.md`. If it's missing, stop and tell the designer
to run `/review $1` first.

Parse every `## Comment N` block into: `page`, `frame` (null if `(optional)`), `nodeId` (normalize
`424-51708` → `424:51708`), `type`, `status` (blank → accepted; one of accepted | overridden |
dismissed), `message` (the prose between `Message:` and `Why:`), `why` (after `Why:`). Keep at most
the first **10**. Skip any block with no `message`.

## 2. Dry run (`--dry-run`)

Print a numbered list: `[type] page → frame (node: nodeId | file-level) [status]` + the first line of
`message` + `📎 why`. Mark dismissed ones as SKIPPED. Then stop — post nothing.

## 3. Post as annotations

Call `mcp__plugin_designagent_designagent__status` to confirm the bridge is live and pointed at the
right file (sanity-check against `projects/$1/context/figma.md`). If it isn't live, stop and ask the
designer to open the file with the DesignAgent Figma plugin (or run `--dry-run`).

For each comment where `status` is **not** `dismissed`:
- Skip if it has no `nodeId` — an annotation must pin to a node. Note the skip (optionally recover a
  top-level frame id via `list_page_nodes` if you can confidently match the page/frame name).
- Otherwise `mcp__plugin_designagent_designagent__annotate({ nodeId, label: "[<type>] <message>",
  suggestion: <why> })`.

Report each as posted / skipped / failed with its node id.

## 4. Record feedback (the memory loop)

Tally `accepted` / `overridden` / `dismissed` / `total`. Then:
- Merge a `feedback` block into `projects/$1/insights/run-manifest.json` (preserve existing keys):
  counts + a `dismissedComments` list (`{ type, page, summary }`, summary = first line of message).
- Append to `projects/$1/memory/session.md` a short "Feedback on posted annotations" note with the
  counts and the dismissed one-liners, so the next `/review` doesn't re-raise them.

Do **not** touch `memory/user-preferences.md` — the designer owns it.

Finish by telling the designer how many annotations were pinned and where (the Figma file from
`figma.md`).
