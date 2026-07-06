# TODO

## SVG/asset export (from Prototo PERF-REPORT, 2026-07-06)
The bridge exports PNG screenshots only — wordmark/logo/icon nodes end up
rebuilt as font text or hand-drawn SVG in prototypes (fidelity gap). Add an
export tool/param that renders selected VECTOR/logo nodes to SVG (or PNG @2x)
files the agent can drop into the project's /assets/. Related: get_spec now
collapses vector leaves to name+bbox — the export tool is the intended way to
consume them.

## get_spec depth/nodeId params (same report, lower priority)
Optional inputSchema params to request a subtree or cap depth for drill-down.
