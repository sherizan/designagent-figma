---
description: Build the plugin, reload it in Figma, and screenshot the result to verify
allowed-tools: Bash(npm run build:*), Bash(npm run typecheck:*), mcp__figma-console__figma_get_status, mcp__figma-console__figma_reload_plugin, mcp__figma-console__figma_take_screenshot, mcp__figma-console__figma_get_console_logs
---

Run the DesignAgent dev loop and report the outcome concisely:

1. Run `npm run build`. If it fails, stop and show the error.
2. Run `mcp__figma-console__figma_get_status` with `probe: true`. If `setup.valid` is not
   true, tell me to open the **Figma Desktop Bridge** plugin in Figma Desktop, then stop.
3. Run `mcp__figma-console__figma_reload_plugin` to load the fresh build.
4. Run `mcp__figma-console__figma_take_screenshot` and show me the result.
5. Run `mcp__figma-console__figma_get_console_logs` and surface any errors/warnings.

Keep the summary to a few lines: build status, reload status, and anything in the logs worth
my attention.
