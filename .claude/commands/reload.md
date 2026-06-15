---
description: Build the plugin and verify the DesignAgent bridge picks up the change in Figma
allowed-tools: Bash(npm run build:*), Bash(npm run typecheck:*), mcp__plugin_designagent_designagent__status, mcp__plugin_designagent_designagent__get_score, mcp__plugin_designagent_designagent__get_spec, mcp__plugin_designagent_designagent__list_issues, mcp__plugin_designagent_designagent__take_screenshot, mcp__plugin_designagent_designagent__console_logs
---

Run the DesignAgent dev loop and report the outcome concisely:

1. Run `npm run build`. If it fails, stop and show the error.
2. Run `mcp__plugin_designagent_designagent__status` to check the bridge. If it errors or the
   bridge is not connected, tell me to open the **DesignAgent** plugin in Figma and click
   **Enable** on the "Claude bridge" bar (the dot turns green), then stop.
3. There's no programmatic plugin-reload (Figma has no API for it). Remind me that to pick up
   this build I should **re-run the DesignAgent plugin in Figma** (Plugins → Development →
   DesignAgent); the bridge reconnects on its own.
4. Run `mcp__plugin_designagent_designagent__status` again and report the connected file,
   current page, and what is selected.
5. If something is selected, run `mcp__plugin_designagent_designagent__get_score` (and
   `list_issues` if useful) so I can confirm the rebuilt plugin analyzes the selection
   correctly. Then run `mcp__plugin_designagent_designagent__take_screenshot` to see the result,
   and `mcp__plugin_designagent_designagent__console_logs` to surface any plugin errors.

Keep the summary to a few lines: build status, bridge status, what the rebuilt plugin reports for
the current selection, and anything notable from the screenshot / logs.
