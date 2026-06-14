import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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

function log(...args: unknown[]): void {
  console.error('[designagent-mcp]', ...args);
}

// ---- WebSocket bridge to the Figma plugin ----

let pluginSocket: WebSocket | null = null;
const pending = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
>();

function handleConnection(socket: WebSocket): void {
  pluginSocket = socket;
  log('DesignAgent plugin connected.');

  socket.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
    let msg: { type?: string; id?: string; ok?: boolean; result?: unknown; error?: string };
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') {
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
    // 'pong' and 'hello' need no handling beyond keeping the socket alive.
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
for (const host of BIND_HOSTS) {
  const display = host.includes(':') ? `[${host}]` : host;
  const wss = new WebSocketServer({ host, port: PORT });
  wss.on('listening', () => log(`WebSocket bridge listening on ws://${display}:${PORT}`));
  wss.on('error', (error: Error) => log(`Bind ${display}:${PORT} failed: ${error.message}`));
  wss.on('connection', handleConnection);
}

// Heartbeat so dead connections are noticed.
setInterval(() => {
  if (pluginSocket && pluginSocket.readyState === WebSocket.OPEN) {
    try {
      pluginSocket.send(JSON.stringify({ type: 'ping' }));
    } catch {
      // ignore
    }
  }
}, 20000);

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

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('DesignAgent MCP server ready (stdio).');
}

main().catch((error) => {
  log(`Fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
