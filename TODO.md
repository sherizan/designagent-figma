# TODO

## Telemetry trim review — 2026-07-13
Read the `tools:2026-07` hash (Upstash console or ask Claude "show telemetry") and decide
which of the 43 tools to cut. Zero-use candidates going in: animation/shader family, clone,
group/ungroup, instantiate_component, annotate, set_grid, set_opacity, set_rotation,
set_text_style. After any cut: update website `lib/tools.ts` (count + entries).

## Verify export_asset nested-instance fallback on real instances
This session's file had no instances; only the fast-error path ran. Exercise the
clone → isolate → export → remove chain on the botim playground's nested components.

## get_spec depth/nodeId params (Prototo perf report, lower priority)
Optional inputSchema params to request a subtree or cap depth for drill-down.
