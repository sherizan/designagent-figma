# Community listing — screenshot shot-list

Goal: sell the **spine** ("Claude's hands & eyes in Figma"), not the (now-minimal) plugin panel.
The hero story is the *two-sided bridge* — Claude Code in the terminal acting on the live Figma
canvas. Lead with motion/result, not UI chrome.

**Visual consistency:** match the brand — warm paper background + Claude coral accent (see the
designagent/site tokens). Light theme. Use one real, recognizable artifact throughout (reuse the
**"Pro plan" pricing card** we've been testing with) so the shots feel like one continuous demo.
Keep terminal font large/legible; trim window chrome; minimal text overlays.

**Specs (verify exact sizes in Figma's publish dialog):**
- **Cover/hero:** ~1920×960 (landscape). This is what shows in search/browse — most important.
- **Screenshots/carousel:** landscape, consistent aspect ratio across all (e.g. 1600×1000). 4–6 total.
- Export @2x, PNG. First screenshot should stand alone (many users only see one).

## Shots

1. **Cover — the one-liner (hero).**
   Split composition: Figma canvas (the pricing card) on one side, a Claude Code terminal on the
   other, joined by a subtle connection motif (line/glow in coral). Overlay text: *"Claude's hands &
   eyes in Figma."* No UI clutter. This single image must convey "AI works inside my Figma file."

2. **Claude builds it — the magic moment.**
   Terminal showing a short prompt (e.g. `> build a pricing card`) next to the canvas where the card
   has appeared. Caption: *"Ask in your terminal — it shows up on the canvas."* This is the
   highest-impact shot; consider making it #1 in the carousel.

3. **Claude edits the live design.**
   A selected frame in Figma + a terminal action that changed it (e.g. *"make the button full-width"*
   or applying an Auto Layout fix), with the before/after visible. Caption: *"It reads and edits the
   real design — not a copy."* Shows the two-way bridge.

4. **The DESIGN.md contract.**
   Editor showing a `DESIGN.md` (token frontmatter — colors/typography/spacing) beside the matching
   Figma design. Caption: *"One design-system-faithful spec your code builds from."* Shows the
   design↔code handshake (the developer side).

5. **Connect + pick your project.**
   The plugin panel: green "Connected" bridge bar + the project picker listing two projects. Caption:
   *"Connect once; pick which project Claude works in."* Shows the actual plugin surface + the picker
   (the one bit of real UI worth showing).

6. **(Optional) Privacy/trust.**
   A simple graphic: "Runs over a local connection on your machine — no design data leaves your
   computer." Reassures on the network-access prompt users will see.

## Capture tips
- Use a clean demo Figma file (the pricing card) and a real terminal session — authenticity reads.
- Keep the green "connected" dot visible in bridge shots so "it's live" is obvious.
- For terminal shots, show a *short* prompt + a crisp result; avoid walls of log text.
- If you annotate, use one coral callout per image, max — let the product carry it.
- Order in the carousel: lead with #2 (build) or #1 (cover), then #3 (edit), #4 (DESIGN.md), #5 (connect).
