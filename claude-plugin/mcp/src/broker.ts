// DesignAgent bridge broker — a tiny, persistent relay daemon.
//
// Why this exists: MCP stdio servers are ephemeral (one process per Claude Code
// session), but the Figma plugin can only be a WebSocket *client* to one fixed
// localhost port. Letting each per-session server bind that port causes the
// "bridge not connected while green" bug (whoever wins the port owns the plugin;
// the rest run bridge-less). The broker flips the invariant: it is the ONLY
// process that binds the port. The plugin and every per-session MCP server
// connect to it as clients, and it relays between them.
//
// Lifecycle: spawned on demand by the first MCP server that finds no broker
// running. Persists across sessions. Idle-shuts-down once no MCP server has been
// connected for IDLE_MS, so it never orphans. Logs to a temp file (its stdio is
// ignored by the detached spawn).

import { appendFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';

// Bump when the broker<->server wire protocol changes incompatibly. A newer MCP
// server that finds an older broker asks it to shut down and respawns a current one.
export const BROKER_PROTOCOL_VERSION = 2;

// Build identity of this running bundle: the mtime of the compiled server.js
// (this CJS bundle, broker + server in one file) captured ONCE at process start.
// A server launched from a freshly built bundle has a newer mtime than a broker
// that's been running since an older build, so it can replace a stale broker even
// when BROKER_PROTOCOL_VERSION didn't change — which is the common case (the wire
// protocol rarely changes, but broker *logic* does). Reading the file instead of
// baking a constant means any rebuild bumps this automatically; a peer that
// predates this field reports 0 (oldest), so it's safely replaced.
export const BUILD_MTIME: number = (() => {
  try {
    return statSync(__filename).mtimeMs;
  } catch {
    return 0;
  }
})();

const PORT = Number(process.env.DESIGNAGENT_BRIDGE_PORT ?? 3790);
const BIND_HOSTS = ['127.0.0.1', '::1'];
const HEARTBEAT_MS = 20000;
const IDLE_MS = Number(process.env.DESIGNAGENT_BROKER_IDLE_MS ?? 60000);
const LOG_FILE = join(tmpdir(), 'designagent-broker.log');

function blog(...args: unknown[]): void {
  try {
    appendFileSync(LOG_FILE, `[broker ${new Date().toISOString()}] ${args.join(' ')}\n`);
  } catch {
    // logging is best-effort
  }
}

interface ServerClient {
  socket: WebSocket;
  sessionId: string;
  root: string;
  label: string;
}

export function runBroker(): void {
  const alive = new WeakSet<WebSocket>();
  let plugin: WebSocket | null = null;
  const servers: ServerClient[] = []; // registration order; newest = active
  // sessionId the plugin explicitly picked for filesystem ops; null = follow newest.
  let selectedSessionId: string | null = null;
  // Which server originated a given tool-call id, so the plugin's response goes back
  // to the right session.
  const requestOrigin = new Map<string, WebSocket>();
  const wssList: WebSocketServer[] = [];
  let idleTimer: NodeJS.Timeout | null = null;

  function activeServer(): ServerClient | null {
    return servers.length > 0 ? servers[servers.length - 1]! : null;
  }

  // The session that should receive reverse-channel (filesystem) ops: the one the
  // plugin selected if it's still connected, else the newest. Clears a stale pick.
  function routeTarget(): ServerClient | null {
    if (selectedSessionId) {
      const picked = servers.find((s) => s.sessionId === selectedSessionId);
      if (picked) {
        return picked;
      }
      selectedSessionId = null;
    }
    return activeServer();
  }

  function send(socket: WebSocket | null, payload: unknown): void {
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify(payload));
      } catch {
        // ignore
      }
    }
  }

  // The plugin only shows "Connected" once it gets a hello_ack carrying an active
  // session id — so the green dot reflects a real, paired session, not just a live
  // broker. Re-acking on active-session change makes the plugin re-pair and drop
  // stale requests (its existing instance-change logic).
  function ackPlugin(): void {
    const active = activeServer();
    if (!plugin || !active) {
      return;
    }
    send(plugin, { type: 'hello_ack', serverInstanceId: active.sessionId, pid: process.pid });
  }

  function armIdleTimer(): void {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    if (servers.length === 0) {
      idleTimer = setTimeout(() => {
        if (servers.length === 0) {
          blog(`idle for ${IDLE_MS}ms with no sessions; shutting down to free port ${PORT}.`);
          process.exit(0);
        }
      }, IDLE_MS);
    }
  }

  function dropServer(socket: WebSocket): void {
    const idx = servers.findIndex((s) => s.socket === socket);
    if (idx === -1) {
      return;
    }
    const wasActive = idx === servers.length - 1;
    servers.splice(idx, 1);
    // Fail any in-flight tool calls that originated from this server.
    for (const [id, origin] of requestOrigin) {
      if (origin === socket) {
        requestOrigin.delete(id);
      }
    }
    if (wasActive) {
      // Promote the next-newest session and re-pair the plugin to it.
      ackPlugin();
    }
    armIdleTimer();
  }

  function handleConnection(socket: WebSocket): void {
    alive.add(socket);
    socket.on('pong', () => alive.add(socket));

    socket.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
      alive.add(socket);
      let msg: {
        type?: string;
        role?: string;
        id?: string;
        sessionId?: string;
        version?: number;
        command?: string;
        params?: unknown;
        ok?: boolean;
        result?: unknown;
        error?: string;
        buildMtime?: number;
        root?: string;
        label?: string;
      };
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') {
        return;
      }

      // A newer MCP server asks us to step aside so it can run a current broker.
      if (msg.type === 'broker_shutdown') {
        blog('received broker_shutdown; exiting.');
        process.exit(0);
      }

      // ---- plugin registers ----
      if (msg.type === 'hello' && msg.role === 'figma-plugin') {
        plugin = socket;
        blog('plugin connected.');
        ackPlugin(); // no-op until a session is active; then the plugin pairs
        return;
      }

      // ---- per-session MCP server registers ----
      if (msg.type === 'register' && msg.role === 'mcp-server') {
        const version = typeof msg.version === 'number' ? msg.version : 0;
        const buildMtime = typeof msg.buildMtime === 'number' ? msg.buildMtime : 0;
        send(socket, {
          type: 'register_ack',
          brokerVersion: BROKER_PROTOCOL_VERSION,
          brokerBuildMtime: BUILD_MTIME
        });
        // The server is newer than us — either a higher wire protocol, or the same
        // protocol built from a newer bundle. Either way it will send broker_shutdown;
        // don't adopt it as a session (we're about to exit).
        if (version > BROKER_PROTOCOL_VERSION || buildMtime > BUILD_MTIME) {
          blog(
            `server (v${version}, build ${buildMtime}) newer than broker ` +
              `(v${BROKER_PROTOCOL_VERSION}, build ${BUILD_MTIME}); awaiting shutdown.`
          );
          return;
        }
        const sessionId = typeof msg.sessionId === 'string' ? msg.sessionId : 'unknown';
        const root = typeof msg.root === 'string' ? msg.root : '';
        const label = typeof msg.label === 'string' && msg.label ? msg.label : sessionId.slice(0, 8);
        // Newest registration becomes active.
        servers.push({ socket, sessionId, root, label });
        blog(`session ${sessionId} registered (active). ${servers.length} session(s).`);
        if (idleTimer) {
          clearTimeout(idleTimer);
          idleTimer = null;
        }
        ackPlugin();
        return;
      }

      // ---- from the plugin ----
      if (socket === plugin) {
        if (msg.type === 'pong') {
          return;
        }
        // Tool-call result heading back to the originating session.
        if (msg.type === 'response' && typeof msg.id === 'string') {
          const origin = requestOrigin.get(msg.id);
          requestOrigin.delete(msg.id);
          send(origin ?? null, msg);
          return;
        }
        // Reverse channel (filesystem) — route to the selected or newest session's project.
        if (msg.type === 'server_request' && typeof msg.id === 'string') {
          const target = routeTarget();
          if (!target) {
            send(plugin, {
              type: 'server_response',
              id: msg.id,
              ok: false,
              error: 'No active Claude session is connected to the bridge.'
            });
            return;
          }
          send(target.socket, msg);
          return;
        }
        return;
      }

      // ---- from a registered session ----
      const fromServer = servers.find((s) => s.socket === socket);
      if (fromServer) {
        if (msg.type === 'pong') {
          return;
        }
        // Tool call heading to the plugin (record origin for the reply).
        if (msg.type === 'request' && typeof msg.id === 'string') {
          if (!plugin || plugin.readyState !== WebSocket.OPEN) {
            send(socket, {
              type: 'response',
              id: msg.id,
              ok: false,
              error:
                'DesignAgent bridge is not connected. In Figma, open the DesignAgent plugin and click "Start" on the Claude bridge bar, then retry.'
            });
            return;
          }
          requestOrigin.set(msg.id, socket);
          send(plugin, msg);
          return;
        }
        // Reverse-channel reply heading back to the plugin.
        if (msg.type === 'server_response' && typeof msg.id === 'string') {
          send(plugin, msg);
          return;
        }
        return;
      }
    });

    socket.on('close', () => {
      if (socket === plugin) {
        plugin = null;
        blog('plugin disconnected.');
      } else {
        dropServer(socket);
      }
    });
    socket.on('error', () => {
      // close will follow
    });
  }

  // Heartbeat: drop sockets that missed the previous round, then probe again.
  setInterval(() => {
    const sockets: WebSocket[] = [];
    if (plugin) sockets.push(plugin);
    for (const s of servers) sockets.push(s.socket);
    for (const socket of sockets) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      if (!alive.has(socket)) {
        try {
          socket.terminate();
        } catch {
          // ignore
        }
        continue;
      }
      alive.delete(socket);
      try {
        socket.ping();
        socket.send(JSON.stringify({ type: 'ping' }));
      } catch {
        // ignore
      }
    }
  }, HEARTBEAT_MS);

  // Bind the primary loopback (127.0.0.1) authoritatively — it's where the MCP
  // server dials and how "localhost" usually resolves. If THAT is taken, another
  // broker already owns the port, so exit and let our spawner reconnect to it.
  // The IPv6 loopback is best-effort: a partial conflict there must NOT kill an
  // otherwise-working broker (that caused flapping/double-spawns).
  function listen(host: string, fatalIfTaken: boolean): void {
    const display = host.includes(':') ? `[${host}]` : host;
    const wss = new WebSocketServer({ host, port: PORT });
    wss.on('listening', () => {
      wssList.push(wss);
      blog(`listening on ws://${display}:${PORT}`);
    });
    wss.on('connection', handleConnection);
    wss.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        if (fatalIfTaken) {
          blog(`port ${PORT} already owned on ${display}; exiting (another broker won).`);
          process.exit(0);
        }
        blog(`secondary ${display}:${PORT} in use; serving on ${BIND_HOSTS[0]} only.`);
        return;
      }
      blog(`bind ${display}:${PORT} failed: ${error.message}`);
    });
  }
  listen(BIND_HOSTS[0]!, true); // 127.0.0.1 — authoritative
  if (BIND_HOSTS[1]) {
    listen(BIND_HOSTS[1], false); // ::1 — best-effort
  }

  armIdleTimer();
  blog(`broker started (protocol v${BROKER_PROTOCOL_VERSION}, pid ${process.pid}).`);
}
