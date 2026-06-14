import { build } from 'esbuild';

// Bundle the MCP server (deps inlined) into a single committed server.js so
// end users can run `node server.js` with no install step.
await build({
  entryPoints: ['src/server.ts'],
  outfile: 'server.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: ['node18'],
  banner: { js: '#!/usr/bin/env node' },
  // ws optional native speedups — not required, keep them external so the
  // bundle stays pure JS and runs everywhere.
  external: ['bufferutil', 'utf-8-validate'],
  logLevel: 'info'
});
