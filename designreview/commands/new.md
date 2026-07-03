---
description: Scaffold a new DesignReview project (context, insights, memory folders + stub files)
argument-hint: <project-name>
allowed-tools: Read, Write, Glob
---

# New project: $ARGUMENTS

Scaffold a DesignReview project from the name `$ARGUMENTS`. This is deterministic file-writing —
create exactly the files below, then stop and tell the designer what to edit next.

## 1. Slug

Slugify `$ARGUMENTS`: lowercase, trim, drop every char that isn't a letter/number/space/hyphen,
replace runs of whitespace with a single `-`, collapse repeated `-`, trim leading/trailing `-`.
(e.g. "Botim Quest" → `botim-quest`.) Call the result `<slug>`.

If `projects/<slug>/` already exists, **stop** — report that the project exists and don't overwrite.

## 2. Create the folders and files

Under `projects/<slug>/` create `context/`, `insights/`, and `memory/`, then write these files.

**Context stubs** — copy each bundled template verbatim, but prepend this frontmatter header (use
today's date for `Created`):

```
---
Project: $ARGUMENTS
Created: <YYYY-MM-DD>
---

```

| Write to | From template |
|---|---|
| `context/prd.md` | `${CLAUDE_PLUGIN_ROOT}/templates/prd.template.md` |
| `context/research.md` | `${CLAUDE_PLUGIN_ROOT}/templates/research.template.md` |
| `context/figma.md` | `${CLAUDE_PLUGIN_ROOT}/templates/figma.template.md` |
| `context/analytics.md` | `${CLAUDE_PLUGIN_ROOT}/templates/analytics.template.md` |
| `context/content.md` | `${CLAUDE_PLUGIN_ROOT}/templates/content.template.md` |
| `context/DESIGN.md` | `${CLAUDE_PLUGIN_ROOT}/templates/DESIGN.template.md` (the review rubric — the designer edits it to their team's principles) |

**Memory files** — write these with the seed content (no template):

- `memory/session.md`:
  ```
  # Session memory

  *No reviews run yet.*
  ```
- `memory/project.md`:
  ```
  # Project memory

  *Durable facts about $ARGUMENTS accumulate here across reviews.*
  ```
- `memory/user-preferences.md`:
  ```
  # User preferences

  *Recurring preferences and overrides. Edit this to steer future reviews (e.g. "always weight
  accessibility highly", "we dismissed copy suggestions about CTA length").*
  ```

Leave `insights/` empty — `/review` fills it.

## 3. Report

Tell the designer the folder was created and the next steps:
1. Edit `context/prd.md` with the requirements.
2. Add the Figma link in `context/figma.md` (or leave it blank to scaffold screens from the PRD).
3. Run `/review <slug>`.
