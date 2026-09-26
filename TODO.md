# TODO

## Verify export_asset nested-instance fallback on real instances
This session's file had no instances; only the fast-error path ran. Exercise the
clone → isolate → export → remove chain on the botim playground's nested components.

## Next spike: editable simulator import (from the 2026-09-26 Prototo → Figma session)
Question: does an Expo web route, captured through the Playwright MCP with computed styles
inlined into the DOM, render acceptably through html_to_design? Probe on one Prototo screen
with a throwaway script. Yes → a bounded `url_to_design` tool in the MCP server. No → design
the native route (React DevTools / Hermes view tree → design tree), which belongs at least half
in Prototo. `capture_simulator` (flat screenshot) shipped in 0.23.0 as the interim.

## Parked (same session; not scheduled)
- `place_icon` — Lucide is cheap (the `lucide` package → SVG → the existing svg path). SF Symbols
  via SF Pro glyph matching is fragile and has redistribution questions; Material is another dep.
- `place_lottie` — render one frame of a Lottie JSON as vectors (rect/ellipse/path layers only).
  New subsystem; needs its own design.

## Later (from the 2026-09-19 competitor survey; not scheduled)
- `find` tool: search a subtree by name / type / text regex (list_page_nodes → drill-down gap).
- `iterate` skill: build → screenshot → compare with a reference → fix, with a call budget.
- Variables write-back from a tokens file (Console MCP / use_figma have it; export_tokens is 171 calls).

