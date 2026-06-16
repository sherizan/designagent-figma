# DesignAgent Plugin — Evaluation Report

**Author:** Session with Claude Code · **Date:** 2026-06-16
**Audience:** DesignAgent plugin dev team
**Basis:** First-hand experience building three artifacts entirely through the DesignAgent
MCP plugin in one session — a **Foundations** token board, a **Components** library, and a
full **prototo landing page** (plus a `DESIGN.md` token spec). Every reproduction below is
drawn from real tool calls in that session (node ids, error strings, and token values are
verbatim).

---

## 1. Summary

`html_to_design` is the workhorse and is genuinely powerful — it rendered large,
multi-section layouts into real, editable Figma layers in a single call. But its HTML→Figma
layout/paint fidelity has several **silent** failure modes (children dropped, gradients
painted white) that cost roughly **8 extra re-render cycles** across the session, most of
them spent diagnosing layout that looked correct in HTML.

**Verdict: high capability, medium reliability.** The tool is worth adopting today if you
work within a known "supported CSS subset." The dev team can close most of the gap by fixing
two things: the flex layout engine (I1) and gradient painting (I2).

---

## 2. Scorecard (1–5)

| Dimension | Score | Note |
|---|---|---|
| Core capability (`html_to_design` breadth) | 5 | Rendered a ~2,700px board and a ~3,700px page as real layers |
| Verification tooling (`take_screenshot`) | 5 | Fast, reliable screenshot-and-iterate loop |
| Bridge tools (`status`, `delete`) | 5 | Reliable (until the bridge dropped at session end) |
| Tool ergonomics / docs | 4 | Clear schemas; `path`-based render convenient; no "supported CSS" doc |
| Layout fidelity | 2 | Flex exact-fit silently drops/overlaps children |
| Paint fidelity | 2 | Gradients render near-white (silent) |
| Token extraction (`get_spec` / `get_design_md`) | 2 | No fill/stroke hex; spacing inferred from layout artifacts |
| Error reporting | 2 | 20s timeout fires on success; dropped children are silent |
| **Overall** | **~3.2** | Strong core, reliability hardening needed |

---

## 3. What worked well

- **`html_to_design` one-shot rendering** of complex layouts into real, editable Figma
  frames / text / rectangles — a ~2,700px-tall token board and a ~3,700px landing page each
  came across in a single call.
- **Automatic font loading** — `Plus Jakarta Sans` and `JetBrains Mono` (Google Fonts)
  resolved with no manual install or upload step.
- **`take_screenshot` verify loop** — the single most valuable tool. It made every issue
  below observable, which is the only reason they were fixable.
- **`path`-based render** (`html_to_design { path: "foundation.html" }`) — clean
  edit-file-then-re-render workflow; no need to inline large HTML each time.
- **`status` / `delete`** — dependable for confirming the bridge and clearing a bad frame
  before re-rendering in place.

---

## 4. Issues

Each issue: **severity · reproduction · root-cause hypothesis · workaround · suggested fix.**

### I1 — Flex exact-fit silently drops/overlaps a child · **HIGH**
- **Repro:** a horizontal flex row whose children's total width ≈ the container width — via
  `flex:1` exact fill, `width:fit-content`, or a `space-between` content-sized child — causes
  the **last** child to wrap onto the **second** child, leaving its own slot blank.
- **Observed in:** foundation brand swatch strip (`flex:1` + `overflow:hidden`); semantic
  cards (4 × 272px = exactly 1136px inner width → the **Info** card was dropped and its blue
  bled into the Warning slot); components nav links and tabs; landing feature cards (`flex:1`
  → the middle "living design system" card vanished); landing stats (`flex:1` → "2.3M"
  vanished and the row reordered); footer columns (col 2/3 overlapped); the logo proof row.
- **Root cause (hypothesis):** off-by-one / rounding in flex main-size distribution produces
  a phantom wrap at zero slack; the wrapped item is then mispositioned over index 1.
- **Workaround (reliability varies):** fixed widths with a few px of trailing slack (reliable
  for boxed items); a trailing invisible spacer child (worked for `nowrap` nav/tabs, **failed**
  for a centered `flex-wrap` row — inconsistent); collapse the row to a single text node (reliable).
- **Suggested fix:** correct main-size rounding so exact-fit never wraps; honor `flex:1` equal
  distribution; and never silently drop a child — clamp or overflow instead so the failure is visible.

### I2 — CSS gradients render as a near-white solid · **HIGH**
- **Repro:** `background: linear-gradient(135deg, #2A2A2E, #18181B)` on the CTA band rendered
  white — making the white headline text invisible. `linear-gradient(150deg, #EC4D97, #B02868)`
  on the split-section visual rendered as washed-out pale pink. A `radial-gradient(...)` hero
  background rendered ~white (benign here, but same root cause).
- **Root cause:** gradient backgrounds aren't parsed/painted; the fallback fill is near-white.
- **Workaround:** replace all gradients with solid fills.
- **Suggested fix:** support `linear-gradient` / `radial-gradient` as Figma `GRADIENT_LINEAR` /
  `GRADIENT_RADIAL` paints. Failing that, flatten to the first or mid color stop (never white)
  and emit a warning so the caller knows fidelity was lost.

### I3 — `html_to_design` 20s timeout: false-negatives, stalled renders, and un-cleanable orphans · **HIGH**
- **Repro (mild — small boards):** the first two foundation render calls returned
  `Error: DesignAgent plugin did not respond within 20s`, yet the frames were actually created
  (`7036:41815` and `7036:42208`, confirmed via `status`). Subsequent calls returned cleanly
  with `{ id }`. Consistent with cold-start / first-paint latency.
- **Repro (severe — the large landing page):** the same MCP call returns the timeout error with
  **no node id**, while the plugin keeps painting the frame *progressively* over 2+ minutes
  (observed section-by-section: nav → hero → features → split → stats). On one attempt the
  render **stalled incomplete** — the "2.3M" stat regressed to an empty box and the CTA band +
  footer never painted. Because the timeout returns **no id**, the resulting partial frame
  **cannot be targeted** by `delete` / `select` / `focus` (all require a node id) — it becomes
  an **orphan**. Re-rendering then adds *another* orphan, and the accumulating node count makes
  every subsequent render slower, so a file that rendered cleanly early starts timing out
  consistently. (There is no exposed "list page children" tool to recover an id, so orphan
  cleanup requires manual deletion in the Figma UI.)
- **Impact:** on large inputs this produces **incomplete output**, **un-cleanable clutter**, and
  a **compounding slowdown** — far worse than a cosmetic false-negative.
- **Suggested fix:** (1) **always return the created node id**, even on a slow/timeout path, so
  callers can verify and clean up; (2) stream progress or signal a terminal "render complete"
  event instead of a fixed 20s cutoff; (3) make renders idempotent or support a `replace`/target
  id so retries don't multiply frames; (4) expose a way to enumerate/select page children by
  position or name as a recovery hatch.

### I4 — Inline styled span inside wrapping text overlaps · **MEDIUM**
- **Repro:** `<h1>From idea to <span class="accent">prototype</span>, in minutes.</h1>` — the
  accent span rendered as a separate, mispositioned text node overlapping the rest of the
  headline.
- **Root cause:** inline children of a wrapping text block aren't laid out as a single text flow.
- **Workaround:** split into separate single-color block text nodes (stacked lines).
- **Suggested fix:** support mixed-style runs within one text node (Figma supports per-character-range
  fills/styles), or lay inline spans out in document flow.

### I5 — Negative margins scramble layout · **LOW–MEDIUM**
- **Repro:** an overlapping avatar stack built with `margin-left: -12px` rendered with
  scrambled / reordered avatars.
- **Workaround:** use a positive `gap` instead of negative margins.
- **Suggested fix:** support negative margins, or document them as unsupported.

### I6 — `get_spec` / `get_design_md` don't expose fill/stroke hex · **MEDIUM**
- **Repro:** on the logo selection, `get_design_md` extracted only `surface: #ffffff`; the
  brand pink and charcoal were not captured (the vector reported `fills: "mixed"`). `get_spec`
  reported fills as `"solid"` / `"mixed"` / `"unknown"` with **no color values**;
  `tokenization.coverage` was 0.5 and `styleRefs` / `variableRefs` were 0. The brand hex had to
  be eyeballed from a screenshot (`#EC4D97`, later user-confirmed).
- **Impact:** undercuts the core "extract design tokens from a Figma selection" value
  proposition.
- **Suggested fix:** resolve and emit concrete fill/stroke hex values (including per-vector
  fills and gradient stops) plus text styles.

### I7 — Token inference treats layout artifacts as a spacing scale · **LOW–MEDIUM**
- **Repro:** `get_design_md` emitted `spacing: { xs: 10px, sm: 208px, md: 260px, lg: 344px }`
  — these are the logo frame's auto-layout gap and padding, not a deliberate spacing scale.
- **Suggested fix:** distinguish incidental layout values from a real scale; gate token
  emission on repetition/frequency across the selection; and label low-confidence inferences
  as such.

---

## 5. Supported-CSS-subset cheatsheet (observed)

**Reliable**
- Vertical flex columns (`flex-direction: column`)
- Single text nodes, including Google fonts and weights
- Solid fills, `border`, `border-radius`, `box-shadow`
- Fixed-width boxed rows with a few px of trailing slack
- `path`-based rendering from an `.html` file

**Avoid / risky**
- `flex:1` or `width:fit-content` rows at exact fit (drops a child — see I1)
- Gradients of any kind (render near-white — see I2)
- Inline styled `<span>`s inside wrapping text (overlap — see I4)
- Negative margins (scramble — see I5)
- Relying on extracted color tokens from `get_spec` / `get_design_md` (see I6)

---

## 6. Prioritized recommendations

1. **Fix flex exact-fit (I1)** — highest impact; eliminates silent child loss across the
   majority of real-world layouts.
2. **Paint gradients (I2)** — or flatten visibly; today's white fallback ships broken UI with
   no warning.
3. **Make `html_to_design` return the node id on slow renders (I3)** — kill the false-negative
   timeout and the duplicate-frame risk it creates.
4. **Support mixed-style text runs (I4).**
5. **Expose fill/stroke hex + text styles and improve token inference (I6, I7).**
6. **Publish a "supported CSS subset" doc** — would have prevented most of the re-renders in
   this session on its own.

---

## Appendix — evidence frames

Three frames were rendered on the Figma canvas during this evaluation and can serve as living
evidence:
- **Foundations** board — final clean render after fixing I1 (brand/neutral/semantic rows).
- **Components** library — final render after fixing I1 (nav/tabs spacer) and the avatar I5 case.
- **prototo landing page** — `landing.html` is complete and correct, with fixes for I1
  (feature/stats cards), I2 (CTA band, split visual), I4 (headline), and the CTA-band
  `position:absolute` collapse. Intermediate renders verified every section correct through the
  stats/split sections. However, full re-renders of this page eventually **hit I3 (severe)**:
  the call times out with no id, the frame paints progressively, and later attempts stalled —
  one only reaching the eyebrow/nav after 2.5 min on a file weighed down by undeletable orphan
  partial frames. Net: the *source* is production-correct; the *canvas* render is blocked by
  plugin render-reliability on a heavy file. Recovery requires manually deleting the orphan
  landing frames in Figma, then re-rendering into the lightened file.
