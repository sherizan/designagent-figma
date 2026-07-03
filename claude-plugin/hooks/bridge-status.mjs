#!/usr/bin/env node
// SessionStart hook: fast, fail-open liveness check for the DesignAgent bridge broker.
// Prints a one-line nudge ONLY when the broker port is closed (the actionable case) and
// stays silent when the daemon is up, so it never becomes session-start noise. Never
// hangs (short timeout), never exits non-zero.
// ponytail: bare TCP liveness only — it can't tell "broker up but plugin not paired"; the
// `status` tool covers that deeper check when Claude actually uses the bridge.
import { createConnection } from 'node:net';

const PORT = Number(process.env.DESIGNAGENT_BRIDGE_PORT ?? 3790);
const TIMEOUT_MS = 400;

const socket = createConnection({ host: '127.0.0.1', port: PORT });
socket.setTimeout(TIMEOUT_MS);

socket.on('connect', () => {
  socket.destroy();
  process.exit(0); // daemon up — stay silent
});

const nudge = () => {
  socket.destroy();
  process.stdout.write(
    "DesignAgent: the Figma bridge isn't running yet. To let Claude read and edit the " +
      'canvas, open the DesignAgent plugin in Figma and click Start on the Claude bridge bar.\n'
  );
  process.exit(0);
};

socket.on('timeout', nudge);
socket.on('error', nudge);
