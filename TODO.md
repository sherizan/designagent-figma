# TODO

## Verify export_asset nested-instance fallback on real instances
This session's file had no instances; only the fast-error path ran. Exercise the
clone → isolate → export → remove chain on the botim playground's nested components.

## Blocked: editable simulator import (from the 2026-09-26 Prototo → Figma session)
Question: does an Expo web route, captured through the Playwright MCP with computed styles
inlined into the DOM, render acceptably through html_to_design? Blocked on 2026-09-26: the
Prototo app (`proto/apps/prototo-app`) has no web target (no react-native-web / react-dom).
Unblock by adding web to the app, then probe one route with a throwaway script. Yes → a bounded
`url_to_design` tool in the MCP server. No → design the native route (React DevTools / Hermes
view tree → design tree), which belongs at least half in Prototo. `capture_simulator` (flat
screenshot) shipped in 0.23.0 as the interim.

## Parked
- SF Symbols in `place_icon` — Apple's license bars redistribution and they're on no CDN; the
  supported path is export-as-SVG → `place_svg`. Lucide + Material shipped in 0.23.0.
- `place_lottie` beyond the static shape subset (precomps, masks, trim paths, gradients, text) —
  would need lottie-web in the plugin UI as a real renderer. Only if a real file needs it.

## Later (from the 2026-09-19 competitor survey; not scheduled)
- `find` tool: search a subtree by name / type / text regex (list_page_nodes → drill-down gap).
- `iterate` skill: build → screenshot → compare with a reference → fix, with a call budget.
- Variables write-back from a tokens file (Console MCP / use_figma have it; export_tokens is 171 calls).

