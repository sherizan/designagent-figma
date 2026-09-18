---
name: claude-design-to-figma
description: >-
  Move a Claude Design project into Figma as real, editable layers through the
  designagent bridge. Use whenever the user mentions Claude Design, claude.ai/design,
  a design export (artifact.html, a "standalone HTML" file, a downloaded .zip with an
  assets/ folder), a /design canvas in the repo (Main.dc.html, *.dc.html, canvas.json),
  or asks to "put this design in Figma", "send it to Figma", "get my Claude Design into
  Figma", "turn these artboards into Figma frames". Renders each artboard with
  html_to_design, verifies with a screenshot, and fixes drift in place. Local, free,
  no seat requirements — Claude Design itself has no Figma export.
---

# claude-design-to-figma — artboards into Figma, one frame each

Claude Design exports HTML; Figma wants layers. `html_to_design` already turns HTML into
frames, text, auto layout and grids. This skill is the walk from a Claude Design project to a
set of verified Figma frames.

Requires the DesignAgent bridge (`status` returns `connected: true`; if not, ask the user to open
the DesignAgent plugin in Figma and click Start). Work inside the project directory: `html_to_design
{ path }` only reads files under it.

## 1. Find the input

| You have | Where the HTML is | Prep needed |
|----------|-------------------|-------------|
| A `.zip` from claude.ai/design (Export → Download as .zip) | unzip into `design/<name>/`: `artifact.html` (or one `.html` per artboard), `assets/` (images, fonts), `manifest.json` | none — already rendered |
| "Export as standalone HTML" | the single `.html` file; images usually inline | none |
| A `/design` canvas in this repo | `Main.dc.html` + sibling `<Name>.dc.html`, `canvas.json`, image files next to them | **rendered twin** (step 2) |
| Only a claude.ai/design link | nothing local | ask the user to export (.zip or standalone HTML) and drop it in the project |

Multiple artboards = multiple frames. Read `canvas.json` when present:
`artboards[].{file,x,y,w,h}` gives each artboard's frame size and canvas position, and
`pages`/`page` group them. Without it, lay frames out in a row, 120 px apart, at each
artboard's natural width.

## 2. `.dc.html` → a rendered twin (skip for exports)

A `.dc.html` is a Design Component, not plain HTML. Write a static twin next to it
(`<Name>.figma.html`, gitignore-worthy) and render that:

- Drop `<script src="./support.js"></script>` and the whole `<script data-dc-script …>` block.
- Unwrap `<x-dc>…</x-dc>`; move everything inside `<helmet>` (styles, font `<link>`s) into `<head>`.
- Resolve templating by hand — you authored it, so you know the values: `{{ hole }}` → the
  literal from `renderVals()`/`data-props` defaults; `<sc-for list="{{ xs }}" as="x">` → the
  repeated markup with each item substituted; `<sc-if value="{{ cond }}">` → keep or drop;
  `<dc-import name="Card" …>` → paste the sibling `Card.dc.html`'s unwrapped body in place.
- Images referenced by bare filename (`<img src="hero.png">`) point at the real file next to the
  artboard; keep the relative path. Never embed `data:` yourself — `html_to_design { path }`
  inlines relative images from the file's folder.
- Keep inline `style=""` attributes exactly; they carry the design.

Rendered exports (`artifact.html`, standalone HTML) need none of this. If an export references
`https://claude.ai/...` images, they are fetched and inlined when public; otherwise download them
into `assets/` and rewrite the `src` to the relative path first.

## 3. Render, one artboard at a time

```
html_to_design { path: "design/app/Main.figma.html", width: <artboard w>, x, y }
```

- `width` = the artboard's `w` from canvas.json, else the root element's fixed width, else 1280.
- `x`/`y` from canvas.json so the Figma page mirrors the canvas; group frames by `page` if you
  need order.
- The tool returns the frame id immediately and paints in the background. Call
  `take_screenshot { nodeId, scale: 1 }` on that id before judging it; retake once if it looks
  half-painted.
- Big pages: render section by section (split the twin at top-level sections) rather than one
  tall frame; `replaceId` re-renders one section in place.

## 4. Verify, then fix in place

Compare the screenshot with the artboard as the user sees it (open the `.dc.html` twin in a
browser via the Playwright tools if available, or read the markup). Typical drift and the fix:

- Wrong font → the family isn't installed in Figma. Tell the user; do not swap fonts silently.
- Text wrapped differently → `set_text_style { wrap }` or widen with `resize`; the renderer
  already gives wrapped text the container width.
- A missing image → check the relative path resolves from the HTML file's folder.
- Colors off → Claude Design uses `oklch()`; convert to hex in the twin.
- One block misplaced → `move` / `resize` / `reparent` it. Never re-render the whole artboard for
  one glitch.

Solid colors and text that exactly match the file's local color variables, paint styles, or text
styles come out bound to them (default `useDesignSystem: true`). If the user wants literal
values, pass `useDesignSystem: false`.

## 5. Hand over

Report each frame: artboard name → Figma node id, plus anything you could not carry over
(CSS animations, custom fonts, oklch colors approximated). Delete the `.figma.html` twins if the
user does not want them kept.
