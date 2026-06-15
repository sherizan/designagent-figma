import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { isAbsolute, relative, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { WebSocketServer, WebSocket } from 'ws';

// DesignAgent MCP server.
//
// Architecture: Claude Code launches this over stdio. It also runs a local
// WebSocket server that the DesignAgent Figma plugin (its UI iframe) connects to
// when the user enables the bridge. MCP tool calls are forwarded to the plugin,
// which runs them against the live Figma document and returns the result.
//
// IMPORTANT: stdout is reserved for the MCP protocol. All logging goes to stderr.

const PORT = Number(process.env.DESIGNAGENT_BRIDGE_PORT ?? 3790);
const REQUEST_TIMEOUT_MS = 20000;
const HEARTBEAT_MS = 20000;

// Identifies this specific server process. Sent to the plugin in the handshake
// ack so the plugin can tell when it has (re)paired with a *different* server
// instance — e.g. after Claude Code restarts and spawns a fresh MCP server.
const SERVER_INSTANCE_ID = randomUUID();

function log(...args: unknown[]): void {
  console.error('[designagent-mcp]', ...args);
}

// ---- WebSocket bridge to the Figma plugin ----

// The ws library has no typings for our liveness flag; track it on the side.
const aliveSockets = new WeakSet<WebSocket>();
let pluginSocket: WebSocket | null = null;
const pending = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
>();

function handleConnection(socket: WebSocket): void {
  pluginSocket = socket;
  aliveSockets.add(socket);
  log('DesignAgent plugin connected.');

  // ws protocol-level pong (from socket.ping()) — proves the peer is alive.
  socket.on('pong', () => {
    aliveSockets.add(socket);
  });

  socket.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
    let msg: {
      type?: string;
      id?: string;
      ok?: boolean;
      result?: unknown;
      error?: string;
      command?: string;
      params?: unknown;
    };
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') {
      return;
    }
    // Reverse channel: the plugin asks the server (filesystem) for something.
    if (msg.type === 'server_request' && typeof msg.id === 'string' && typeof msg.command === 'string') {
      const id = msg.id;
      const params = msg.params && typeof msg.params === 'object' ? (msg.params as Record<string, unknown>) : {};
      handleServerRequest(msg.command, params)
        .then((result) => socket.send(JSON.stringify({ type: 'server_response', id, ok: true, result })))
        .catch((error: unknown) =>
          socket.send(
            JSON.stringify({
              type: 'server_response',
              id,
              ok: false,
              error: error instanceof Error ? error.message : String(error)
            })
          )
        );
      return;
    }
    if (msg.type === 'response' && typeof msg.id === 'string') {
      const entry = pending.get(msg.id);
      if (!entry) {
        return;
      }
      pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.ok) {
        entry.resolve(msg.result);
      } else {
        entry.reject(new Error(msg.error || 'DesignAgent plugin reported an error.'));
      }
    }
    // The plugin announces itself with `hello`; acknowledge it so the plugin
    // only shows "Connected" once it has confirmed a live, end-to-end pairing
    // with *this* server instance (not merely an open socket to port 3790).
    if (msg.type === 'hello') {
      aliveSockets.add(socket);
      try {
        socket.send(
          JSON.stringify({ type: 'hello_ack', serverInstanceId: SERVER_INSTANCE_ID, pid: process.pid })
        );
      } catch {
        // ignore
      }
      return;
    }
    // App-level 'pong' (reply to our JSON ping) also marks the socket alive.
    if (msg.type === 'pong') {
      aliveSockets.add(socket);
    }
  });

  socket.on('close', () => {
    if (pluginSocket === socket) {
      pluginSocket = null;
    }
    log('DesignAgent plugin disconnected.');
  });

  socket.on('error', (error: Error) => {
    log(`Plugin socket error: ${error.message}`);
  });
}

// Bind both loopback addresses (IPv4 127.0.0.1 + IPv6 ::1) so the plugin reaches
// us regardless of how "localhost" resolves on this machine — while staying
// loopback-only (never exposed to the LAN). The manifest allows http://localhost
// and the plugin connects to ws://localhost; CSP matches on the host name.
const BIND_HOSTS = ['127.0.0.1', '::1'];
const BIND_RETRY_MS = 250;
const BIND_MAX_ATTEMPTS = 40; // ~10s of retries

// A previous server process (e.g. before a Claude Code restart) can still hold
// the port for a moment. Rather than failing permanently and leaving the bridge
// dead, retry the bind until the orphan releases it. The old process now exits
// on stdin close (see main()), so the window is short.
function bind(host: string, attempt = 1): void {
  const display = host.includes(':') ? `[${host}]` : host;
  const wss = new WebSocketServer({ host, port: PORT });
  wss.on('listening', () => log(`WebSocket bridge listening on ws://${display}:${PORT}`));
  wss.on('connection', handleConnection);
  wss.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE' && attempt < BIND_MAX_ATTEMPTS) {
      log(`Bind ${display}:${PORT} in use (attempt ${attempt}), retrying in ${BIND_RETRY_MS}ms…`);
      setTimeout(() => bind(host, attempt + 1), BIND_RETRY_MS);
      return;
    }
    log(`Bind ${display}:${PORT} failed: ${error.message}`);
  });
}
for (const host of BIND_HOSTS) {
  bind(host);
}

// Heartbeat so dead (including half-open) connections are noticed and cleared.
// First drop any socket that didn't answer the previous round, then probe again
// with both a ws-level ping and the app-level JSON ping the plugin UI expects.
setInterval(() => {
  const socket = pluginSocket;
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }
  if (!aliveSockets.has(socket)) {
    log('Plugin socket missed heartbeat; terminating.');
    if (pluginSocket === socket) {
      pluginSocket = null;
    }
    try {
      socket.terminate();
    } catch {
      // ignore
    }
    return;
  }
  aliveSockets.delete(socket);
  try {
    socket.ping();
    socket.send(JSON.stringify({ type: 'ping' }));
  } catch {
    // ignore
  }
}, HEARTBEAT_MS);

function callPlugin(command: string, params: Record<string, unknown> = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!pluginSocket || pluginSocket.readyState !== WebSocket.OPEN) {
      reject(
        new Error(
          'DesignAgent bridge is not connected. In Figma, open the DesignAgent plugin and click "Enable" on the Claude bridge bar, then retry.'
        )
      );
      return;
    }
    const id = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`DesignAgent plugin did not respond within ${REQUEST_TIMEOUT_MS / 1000}s.`));
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    try {
      pluginSocket.send(JSON.stringify({ type: 'request', id, command, params }));
    } catch (error) {
      pending.delete(id);
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

// ---- MCP server + tools ----

const server = new McpServer({ name: 'designagent', version: '0.1.0' });

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

function ok(value: unknown): ToolResult {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text }] };
}

function fail(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

async function run(command: string, params: Record<string, unknown> = {}): Promise<ToolResult> {
  try {
    return ok(await callPlugin(command, params));
  } catch (error) {
    return fail(error);
  }
}

const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB — keeps the bridge payload sane

// Resolve an image source (url | path | data) to base64. The server does this
// IO because the Figma plugin sandbox can't make network/file requests.
async function loadImageBase64(args: {
  url?: string;
  path?: string;
  data?: string;
}): Promise<string> {
  let buf: Buffer;
  if (args.data) {
    const m = /^data:[^;]+;base64,(.+)$/.exec(args.data);
    buf = Buffer.from(m ? m[1] : args.data, 'base64');
  } else if (args.path) {
    buf = await readFile(args.path);
  } else if (args.url) {
    const res = await fetch(args.url);
    if (!res.ok) {
      throw new Error(`Failed to fetch image: HTTP ${res.status} ${res.statusText}`);
    }
    buf = Buffer.from(await res.arrayBuffer());
  } else {
    throw new Error('Provide an image source: one of "url", "path", or "data".');
  }
  if (buf.length > MAX_IMAGE_BYTES) {
    throw new Error(
      `Image is ${(buf.length / 1024 / 1024).toFixed(1)} MB; max is ${MAX_IMAGE_BYTES / 1024 / 1024} MB. Use a smaller image.`
    );
  }
  return buf.toString('base64');
}

// The directory the file browser scans. Defaults to where Claude Code launched
// the server; override with DESIGNAGENT_PROJECT_DIR if your HTML lives elsewhere.
const PROJECT_ROOT = process.env.DESIGNAGENT_PROJECT_DIR
  ? resolve(process.env.DESIGNAGENT_PROJECT_DIR)
  : process.cwd();

// Resolve a path inside the project (the dir Claude Code launched in), rejecting
// anything that escapes it. Shared by every filesystem read/write below.
function resolveInProject(path: string): string {
  const abs = resolve(PROJECT_ROOT, path);
  const rel = relative(PROJECT_ROOT, abs);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Path is outside the project directory.');
  }
  return abs;
}

// Read an .html file from inside the project (the dir Claude Code launched in).
async function readHtmlFile(path: string): Promise<string> {
  return readFile(resolveInProject(path), 'utf8');
}

// SSRF guard: reject loopback / private / link-local / metadata addresses.
function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const o = ip.split('.').map(Number);
    if (o[0] === 127 || o[0] === 10 || o[0] === 0) return true;
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true;
    if (o[0] === 192 && o[1] === 168) return true;
    if (o[0] === 169 && o[1] === 254) return true; // link-local + cloud metadata
    if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return true; // CGNAT
    return false;
  }
  if (family === 6) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('fe80') || v.startsWith('fc') || v.startsWith('fd')) return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  return true; // unparseable → treat as unsafe
}

async function assertPublicUrl(rawUrl: string): Promise<void> {
  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Blocked URL scheme');
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  const addrs = await lookup(host, { all: true });
  if (addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address))) {
    throw new Error('Blocked non-public address');
  }
}

// Fetch an image URL with SSRF protections: validate the host, follow redirects
// manually and re-validate each hop.
async function safeImageFetch(rawUrl: string, hops = 0): Promise<Response | null> {
  if (hops > 3) return null;
  await assertPublicUrl(rawUrl);
  const res = await fetch(rawUrl, { redirect: 'manual' });
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get('location');
    if (!location) return null;
    return safeImageFetch(new URL(location, rawUrl).toString(), hops + 1);
  }
  return res;
}

// Inline external <img src="http(s)://…"> as data URLs so the plugin can embed
// them (the plugin UI can't fetch arbitrary domains). Best-effort, budgeted,
// and SSRF-guarded (skips loopback/private/metadata hosts).
async function inlineExternalImages(html: string): Promise<string> {
  const matches = Array.from(html.matchAll(/<img\b[^>]*\bsrc=["'](https?:\/\/[^"']+)["']/gi));
  let result = html;
  let budget = 10;
  for (const match of matches) {
    if (budget <= 0) break;
    const url = match[1];
    try {
      const res = await safeImageFetch(url);
      if (!res || !res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_IMAGE_BYTES) continue;
      const contentType = res.headers.get('content-type') || 'image/png';
      result = result.split(url).join(`data:${contentType};base64,${buf.toString('base64')}`);
      budget -= 1;
    } catch {
      // skip unreachable / blocked images
    }
  }
  return result;
}

// Reverse channel: the plugin asks the server for project files.
const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.next',
  'build',
  'out',
  '.cache',
  'coverage'
]);

interface HtmlFileEntry {
  path: string;
  name: string;
  dir: string;
  size: number;
}

async function listHtmlFiles(): Promise<HtmlFileEntry[]> {
  const results: HtmlFileEntry[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (results.length >= 100 || depth > 6) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= 100) break;
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        await walk(full, depth + 1);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
        let size = 0;
        try {
          size = (await stat(full)).size;
        } catch {
          // ignore
        }
        results.push({
          path: relative(PROJECT_ROOT, full),
          name: entry.name,
          dir: relative(PROJECT_ROOT, dir) || '.',
          size
        });
      }
    }
  }
  await walk(PROJECT_ROOT, 0);
  results.sort((a, b) => a.path.localeCompare(b.path));
  return results;
}

async function handleServerRequest(command: string, params: Record<string, unknown>): Promise<unknown> {
  switch (command) {
    case 'list_html_files':
      return { root: PROJECT_ROOT, files: await listHtmlFiles() };
    case 'read_html_file': {
      const path = String(params.path ?? '');
      if (!path) {
        throw new Error('read_html_file requires "path".');
      }
      const html = await inlineExternalImages(await readHtmlFile(path));
      return { html };
    }
    case 'check_design_md': {
      const path = String(params.path ?? 'DESIGN.md');
      try {
        const content = await readFile(resolveInProject(path), 'utf8');
        return { exists: true, root: PROJECT_ROOT, path, content };
      } catch {
        return { exists: false, root: PROJECT_ROOT, path };
      }
    }
    case 'write_design_md': {
      const path = String(params.path ?? 'DESIGN.md');
      const content = String(params.content ?? '');
      const abs = resolveInProject(path);
      await writeFile(abs, content, 'utf8');
      return { ok: true, root: PROJECT_ROOT, path, bytes: Buffer.byteLength(content, 'utf8') };
    }
    default:
      throw new Error(`Unknown server command: ${command}`);
  }
}

const IMAGE_SOURCE_SCHEMA = {
  url: z.string().optional().describe('Image URL (fetched by the server).'),
  path: z.string().optional().describe('Absolute local file path to an image.'),
  data: z.string().optional().describe('Base64 image data or a data: URL.'),
  scaleMode: z.enum(['FILL', 'FIT', 'CROP', 'TILE']).optional().describe('Default FILL.')
};

server.registerTool(
  'status',
  {
    description:
      'Check the DesignAgent bridge: returns the connected Figma file name, current page, and what is selected. Call this first to confirm the bridge is live.'
  },
  async () => run('status')
);

server.registerTool(
  'get_design_md',
  {
    description:
      'Export the current Figma selection (frames/sections/components) as a clean DESIGN.md spec — design tokens, components, layout, text — ready to build from. Returns Markdown.'
  },
  async () => {
    try {
      const result = (await callPlugin('get_design_md')) as { markdown?: string };
      return ok(result?.markdown ?? result);
    } catch (error) {
      return fail(error);
    }
  }
);

server.registerTool(
  'get_spec',
  {
    description:
      'Get the structured UI spec (hierarchy, tokens, layout, text, components) for the current Figma selection as JSON.'
  },
  async () => run('get_spec')
);

server.registerTool(
  'get_score',
  {
    description:
      "Get DesignAgent's AI-readiness score and per-category breakdown for the current Figma selection."
  },
  async () => run('get_score')
);

server.registerTool(
  'list_issues',
  {
    description:
      'List the design-readiness issues DesignAgent found on the current Figma selection (node id, category, reason, suggestion).'
  },
  async () => run('list_issues')
);

server.registerTool(
  'focus',
  {
    description: 'Select a node by id in Figma and scroll/zoom it into view.',
    inputSchema: { nodeId: z.string().describe('The Figma node id to focus (e.g. "123:45").') }
  },
  async ({ nodeId }) => run('focus', { nodeId })
);

server.registerTool(
  'select',
  {
    description: 'Set the Figma selection to one or more nodes by id and zoom to them.',
    inputSchema: { nodeIds: z.array(z.string()).describe('Figma node ids to select.') }
  },
  async ({ nodeIds }) => run('select', { nodeIds })
);

server.registerTool(
  'annotate',
  {
    description:
      'Add a DesignAgent annotation to a Figma node, capturing design intent or a requirement.',
    inputSchema: {
      nodeId: z.string().describe('The Figma node id to annotate.'),
      label: z.string().describe('The annotation text / requirement.'),
      suggestion: z.string().optional().describe('Optional extra detail or suggested fix.')
    }
  },
  async ({ nodeId, label, suggestion }) => run('annotate', { nodeId, label, suggestion })
);

server.registerTool(
  'apply_fix',
  {
    description:
      'Apply a DesignAgent auto-fix to a Figma node. "auto-layout" converts a manual frame to Auto Layout; "absolute-positioning" returns an absolutely-positioned child to normal flow.',
    inputSchema: {
      nodeId: z.string().describe('The Figma node id to fix.'),
      fix: z
        .enum(['auto-layout', 'absolute-positioning'])
        .describe('Which fix to apply.')
    }
  },
  async ({ nodeId, fix }) => run('apply_fix', { nodeId, fix })
);

// ---- Create / edit tools (design from Claude into Figma) ----

const COLOR = z.string().describe('Hex color, e.g. "#3366ff" (optional 8-digit for alpha).');

server.registerTool(
  'create_frame',
  {
    description:
      'Create a frame on the Figma canvas. Optionally give it Auto Layout. Defaults to the current page at (0,0) sized 100×100; pass parentId to nest it inside another frame/section.',
    inputSchema: {
      name: z.string().optional(),
      parentId: z.string().optional().describe('Container node id to nest inside; omit for current page.'),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      layoutMode: z.enum(['NONE', 'HORIZONTAL', 'VERTICAL']).optional(),
      itemSpacing: z.number().optional().describe('Gap between children when Auto Layout is on.'),
      padding: z.number().optional().describe('Uniform padding (all sides) when Auto Layout is on.'),
      fill: COLOR.optional(),
      cornerRadius: z.number().optional(),
      stroke: COLOR.optional().describe('Border color.'),
      strokeWeight: z.number().optional(),
      strokeAlign: z.enum(['INSIDE', 'OUTSIDE', 'CENTER']).optional()
    }
  },
  async (args) => run('create_frame', args as Record<string, unknown>)
);

server.registerTool(
  'create_text',
  {
    description: 'Create a text node on the Figma canvas (font loading is handled automatically).',
    inputSchema: {
      characters: z.string().describe('The text content.'),
      name: z.string().optional(),
      parentId: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      fontSize: z.number().optional(),
      weight: z
        .union([z.string(), z.number()])
        .optional()
        .describe('Font weight: a number (400, 600, 700) or a style name ("Medium", "Bold").'),
      color: COLOR.optional(),
      align: z.enum(['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED']).optional()
    }
  },
  async (args) => run('create_text', args as Record<string, unknown>)
);

server.registerTool(
  'create_rectangle',
  {
    description: 'Create a rectangle shape on the Figma canvas.',
    inputSchema: {
      name: z.string().optional(),
      parentId: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      fill: COLOR.optional(),
      cornerRadius: z.number().optional(),
      stroke: COLOR.optional().describe('Border color.'),
      strokeWeight: z.number().optional(),
      strokeAlign: z.enum(['INSIDE', 'OUTSIDE', 'CENTER']).optional()
    }
  },
  async (args) => run('create_rectangle', args as Record<string, unknown>)
);

server.registerTool(
  'create_ellipse',
  {
    description: 'Create an ellipse shape on the Figma canvas.',
    inputSchema: {
      name: z.string().optional(),
      parentId: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      fill: COLOR.optional(),
      stroke: COLOR.optional().describe('Border color.'),
      strokeWeight: z.number().optional(),
      strokeAlign: z.enum(['INSIDE', 'OUTSIDE', 'CENTER']).optional()
    }
  },
  async (args) => run('create_ellipse', args as Record<string, unknown>)
);

server.registerTool(
  'set_text',
  {
    description: 'Replace the text content of an existing text node.',
    inputSchema: {
      nodeId: z.string().describe('The text node id.'),
      characters: z.string().describe('The new text content.')
    }
  },
  async ({ nodeId, characters }) => run('set_text', { nodeId, characters })
);

server.registerTool(
  'set_text_style',
  {
    description:
      'Style an existing text node: font size, weight, color, and alignment. Weight resolves against the font family’s available styles.',
    inputSchema: {
      nodeId: z.string(),
      fontSize: z.number().optional(),
      weight: z
        .union([z.string(), z.number()])
        .optional()
        .describe('A number (400, 600, 700) or a style name ("Medium", "Semi Bold", "Bold").'),
      color: COLOR.optional(),
      align: z.enum(['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED']).optional(),
      valign: z.enum(['TOP', 'CENTER', 'BOTTOM']).optional()
    }
  },
  async (args) => run('set_text_style', args as Record<string, unknown>)
);

server.registerTool(
  'set_fill',
  {
    description: 'Set a solid fill color on an existing node.',
    inputSchema: { nodeId: z.string(), color: COLOR }
  },
  async ({ nodeId, color }) => run('set_fill', { nodeId, color })
);

server.registerTool(
  'set_corner_radius',
  {
    description:
      'Round the corners of an existing node (frame, rectangle, component). Pass `radius` for all corners, or individual corners for asymmetric rounding.',
    inputSchema: {
      nodeId: z.string(),
      radius: z.number().optional().describe('Uniform corner radius for all four corners.'),
      topLeft: z.number().optional(),
      topRight: z.number().optional(),
      bottomLeft: z.number().optional(),
      bottomRight: z.number().optional()
    }
  },
  async (args) => run('set_corner_radius', args as Record<string, unknown>)
);

server.registerTool(
  'set_stroke',
  {
    description: 'Add or change the border (stroke) of an existing node.',
    inputSchema: {
      nodeId: z.string(),
      color: COLOR,
      weight: z.number().optional().describe('Stroke thickness in px (default 1).'),
      align: z.enum(['INSIDE', 'OUTSIDE', 'CENTER']).optional()
    }
  },
  async ({ nodeId, color, weight, align }) => run('set_stroke', { nodeId, color, weight, align })
);

server.registerTool(
  'set_shadow',
  {
    description: 'Add a drop shadow to an existing node.',
    inputSchema: {
      nodeId: z.string(),
      color: COLOR.optional().describe('Shadow color, supports 8-digit hex alpha (default #00000040).'),
      offsetX: z.number().optional().describe('Horizontal offset (default 0).'),
      offsetY: z.number().optional().describe('Vertical offset (default 4).'),
      blur: z.number().optional().describe('Blur radius (default 8).'),
      spread: z.number().optional().describe('Spread (default 0).'),
      opacity: z.number().optional().describe('Override alpha 0–1.')
    }
  },
  async (args) => run('set_shadow', args as Record<string, unknown>)
);

server.registerTool(
  'set_image',
  {
    description:
      'Fill an existing node with an image from a URL, a local file path, or base64. The server fetches/reads it (the Figma sandbox cannot).',
    inputSchema: { nodeId: z.string(), ...IMAGE_SOURCE_SCHEMA }
  },
  async (args) => {
    try {
      const imageBase64 = await loadImageBase64(args);
      return run('set_image', { nodeId: args.nodeId, imageBase64, scaleMode: args.scaleMode });
    } catch (error) {
      return fail(error);
    }
  }
);

server.registerTool(
  'place_image',
  {
    description:
      'Create a new image node on the canvas from a URL, local path, or base64. Sized to the image unless width/height are given.',
    inputSchema: {
      ...IMAGE_SOURCE_SCHEMA,
      name: z.string().optional(),
      parentId: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional()
    }
  },
  async (args) => {
    try {
      const imageBase64 = await loadImageBase64(args);
      return run('place_image', {
        imageBase64,
        scaleMode: args.scaleMode,
        name: args.name,
        parentId: args.parentId,
        x: args.x,
        y: args.y,
        width: args.width,
        height: args.height
      });
    } catch (error) {
      return fail(error);
    }
  }
);

// ---- Layout ops ----

server.registerTool(
  'move',
  {
    description: 'Move a node to new x/y coordinates (ignored for nodes inside Auto Layout).',
    inputSchema: { nodeId: z.string(), x: z.number().optional(), y: z.number().optional() }
  },
  async (args) => run('move', args as Record<string, unknown>)
);

server.registerTool(
  'resize',
  {
    description: 'Resize a node. Omitted dimensions keep their current value.',
    inputSchema: { nodeId: z.string(), width: z.number().optional(), height: z.number().optional() }
  },
  async (args) => run('resize', args as Record<string, unknown>)
);

server.registerTool(
  'reparent',
  {
    description:
      'Move a node into a different parent (frame/section/component, or the page if parentId is omitted). Optional index sets its order among siblings.',
    inputSchema: {
      nodeId: z.string(),
      parentId: z.string().optional().describe('New parent node id; omit to move to the page.'),
      index: z.number().optional().describe('Insertion index among the parent’s children.'),
      x: z.number().optional(),
      y: z.number().optional()
    }
  },
  async (args) => run('reparent', args as Record<string, unknown>)
);

server.registerTool(
  'delete',
  {
    description: 'Delete a node from the Figma document.',
    inputSchema: { nodeId: z.string() }
  },
  async ({ nodeId }) => run('delete', { nodeId })
);

// ---- Advanced ops ----

server.registerTool(
  'clone',
  {
    description:
      'Duplicate a node. The copy lands in the same parent unless parentId is given; pass x/y to position it.',
    inputSchema: {
      nodeId: z.string(),
      parentId: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional()
    }
  },
  async (args) => run('clone', args as Record<string, unknown>)
);

server.registerTool(
  'group',
  {
    description: 'Group two or more nodes into a single group.',
    inputSchema: { nodeIds: z.array(z.string()).describe('Node ids to group.'), name: z.string().optional() }
  },
  async (args) => run('group', args as Record<string, unknown>)
);

server.registerTool(
  'ungroup',
  {
    description: 'Ungroup a group node, returning its children to the parent.',
    inputSchema: { nodeId: z.string() }
  },
  async ({ nodeId }) => run('ungroup', { nodeId })
);

server.registerTool(
  'set_opacity',
  {
    description: 'Set a node’s opacity (0–1).',
    inputSchema: { nodeId: z.string(), opacity: z.number().describe('0 (transparent) to 1 (opaque).') }
  },
  async ({ nodeId, opacity }) => run('set_opacity', { nodeId, opacity })
);

server.registerTool(
  'set_rotation',
  {
    description: 'Rotate a node by an angle in degrees.',
    inputSchema: { nodeId: z.string(), rotation: z.number().describe('Rotation in degrees.') }
  },
  async ({ nodeId, rotation }) => run('set_rotation', { nodeId, rotation })
);

server.registerTool(
  'instantiate_component',
  {
    description:
      'Create an instance of a component. Use componentId for a component in this file, or componentKey for a published library component.',
    inputSchema: {
      componentId: z.string().optional().describe('A COMPONENT or COMPONENT_SET node id in this file.'),
      componentKey: z.string().optional().describe('A published library component key.'),
      parentId: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional()
    }
  },
  async (args) => run('instantiate_component', args as Record<string, unknown>)
);

server.registerTool(
  'batch',
  {
    description:
      'Run multiple bridge operations in one call (e.g. delete or restyle many nodes). Each item is { command, params } using any other tool name. Returns per-op results; one failure does not stop the rest.',
    inputSchema: {
      operations: z
        .array(
          z.object({
            command: z.string().describe('A bridge command name, e.g. "set_fill", "delete", "move".'),
            params: z.record(z.any()).optional()
          })
        )
        .describe('Operations to run in order.')
    }
  },
  async (args) => {
    try {
      const operations = [];
      for (const op of args.operations) {
        const params: Record<string, unknown> = op.params ? { ...op.params } : {};
        // Resolve image sources server-side for image ops inside the batch.
        if (
          (op.command === 'place_image' || op.command === 'set_image') &&
          params.imageBase64 == null
        ) {
          params.imageBase64 = await loadImageBase64(params);
        }
        operations.push({ command: op.command, params });
      }
      return run('batch', { operations });
    } catch (error) {
      return fail(error);
    }
  }
);

server.registerTool(
  'html_to_design',
  {
    description:
      'Render HTML into Figma as real layers (frames, text, rectangles, images). Provide `html` directly OR a `path` to an .html file in the project (e.g. one you just generated). Structural fidelity — fonts must exist in the Figma file; external images are inlined. The DesignAgent plugin must be open with the bridge enabled.',
    inputSchema: {
      html: z.string().optional().describe('Raw HTML to render.'),
      path: z.string().optional().describe('Path to an .html file in the project.'),
      x: z.number().optional(),
      y: z.number().optional(),
      parentId: z.string().optional(),
      width: z.number().optional().describe('Render viewport width in px (default 1280).')
    }
  },
  async (args) => {
    try {
      let html = args.html;
      if (!html && args.path) {
        html = await readHtmlFile(args.path);
      }
      if (!html) {
        return fail(new Error('Provide "html" or "path".'));
      }
      html = await inlineExternalImages(html);
      return run('html_to_design', {
        html,
        x: args.x,
        y: args.y,
        parentId: args.parentId,
        width: args.width
      });
    } catch (error) {
      return fail(error);
    }
  }
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(`DesignAgent MCP server ready (stdio). instance=${SERVER_INSTANCE_ID} pid=${process.pid}`);

  // When Claude Code replaces or shuts down this server, our stdin closes.
  // Exit promptly so we release the WebSocket port (3790) instead of orphaning
  // and squatting it — which would leave the replacement server unable to bind
  // and the plugin paired to a dead instance.
  const exit = () => {
    log('stdin closed; shutting down to release the bridge port.');
    process.exit(0);
  };
  process.stdin.on('close', exit);
  process.stdin.on('end', exit);
}

main().catch((error) => {
  log(`Fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
