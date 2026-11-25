// In-panel chat (prototype): the broker drives the user's own Claude Code headless
// (`claude -p`) in the selected project folder and relays its stream to the Figma
// panel. The login and the subscription stay with the local `claude` CLI; nothing
// here touches credentials.
//
// One process per turn; follow-up turns pass `--resume <session id>` so the
// conversation continues. The child gets exactly one MCP server, this same bundle,
// so it reaches Figma through the broker like any other session.

import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

export type ChatEvent =
  | { kind: 'start' }
  | { kind: 'text'; text: string } // streamed delta of the reply
  | { kind: 'tool'; id: string; name: string } // a tool call began
  | { kind: 'tool_done'; id: string; ok: boolean }
  | { kind: 'done'; ok: boolean; error?: string; costUsd?: number; needsPairing?: boolean }
  | { kind: 'reset' };

export interface ChatSendOptions {
  root: string;
  text: string;
  allowEdits: boolean;
}

// Pairing code: the broker's port is reachable by any local process and by any web
// page (WebSockets are not bound by same-origin), so a chat request must prove it
// comes from the user's own panel. The code lives in an owner-only file; the user
// pastes it into the panel once.
export const CHAT_CODE_FILE = join(homedir(), '.designagent-chat-code');

export function chatCode(): string {
  try {
    const existing = readFileSync(CHAT_CODE_FILE, 'utf8').trim();
    if (existing.length >= 32) {
      return existing;
    }
  } catch {
    // not created yet
  }
  const code = randomBytes(24).toString('hex');
  writeFileSync(CHAT_CODE_FILE, code + '\n', { mode: 0o600 });
  return code;
}

export function chatCodeMatches(candidate: unknown): boolean {
  if (typeof candidate !== 'string') {
    return false;
  }
  let expected: Buffer;
  try {
    expected = Buffer.from(chatCode());
  } catch {
    return false; // cannot read or create the code: refuse rather than run open
  }
  const given = Buffer.from(candidate.trim());
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// Places the chat may read but never write (compared lower-case).
const PROTECTED_DIRS = new Set(['.claude', '.git', '.github', '.vscode', '.idea', '.husky', '.cursor', '.devcontainer']);
const PROTECTED_FILES = new Set(['.mcp.json', '.envrc', '.npmrc', '.gitconfig', '.gitmodules']);

// The only built-in tools the chat session gets; all of them go through the guard.
const GUARDED_TOOLS = ['Read', 'Glob', 'Grep', 'Edit', 'Write'];

function realOrSelf(path: string, depth = 0): string {
  // Resolve symlinks on the deepest part that exists, so a link out of the project
  // (or a not-yet-created file under one) is judged by where it really points.
  let current = path;
  let rest = '';
  for (;;) {
    try {
      return join(realpathSync(current), rest);
    } catch {
      // realpath also fails on a dangling link, which a write would still follow:
      // judge it by its target. A chain that never settles is treated as outside.
      try {
        if (lstatSync(current).isSymbolicLink()) {
          if (depth > 20) {
            return sep + 'unresolvable-symlink';
          }
          return realOrSelf(join(resolve(dirname(current), readlinkSync(current)), rest), depth + 1);
        }
      } catch {
        // does not exist at all: keep walking up
      }
      const parent = dirname(current);
      if (parent === current) {
        return path;
      }
      rest = join(current.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)), rest);
      current = parent;
    }
  }
}

// PreToolUse hook body. Reads the hook JSON on stdin; exit 2 blocks the tool call
// and shows the stderr text to the model. Anything it cannot parse is blocked.
export function runChatGuard(): void {
  const root = process.env.DESIGNAGENT_CHAT_ROOT ?? '';
  let raw = '';
  process.stdin.on('data', (chunk: Buffer) => {
    raw += chunk.toString('utf8');
  });
  process.stdin.on('end', () => {
    const block = (why: string): never => {
      process.stderr.write(`Blocked by DesignAgent chat: ${why} Only files inside the project folder are available here.`);
      process.exit(2);
    };
    if (!root) {
      block('no project folder is set.');
    }
    let input: { cwd?: unknown; tool_name?: unknown; tool_input?: Record<string, unknown> };
    try {
      input = JSON.parse(raw) as typeof input;
    } catch {
      return block('unreadable tool request.');
    }
    const realRoot = realOrSelf(resolve(root));
    const base = typeof input.cwd === 'string' && input.cwd ? input.cwd : root;
    const params = input.tool_input ?? {};
    const toolName = typeof input.tool_name === 'string' ? input.tool_name : '';
    const writes = toolName !== 'Read' && toolName !== 'Glob' && toolName !== 'Grep';
    const realOf = (candidate: string): string => {
      const expanded = candidate.startsWith('~') ? join(homedir(), candidate.slice(1)) : candidate;
      return realOrSelf(isAbsolute(expanded) ? resolve(expanded) : resolve(base, expanded));
    };
    for (const key of ['file_path', 'path', 'notebook_path']) {
      const value = params[key];
      if (typeof value !== 'string' || !value) {
        continue;
      }
      const real = realOf(value);
      if (real !== realRoot && !real.startsWith(realRoot + sep)) {
        block(`${value} is outside the project.`);
      }
      // Never write tool, editor or repo configuration: a planted hook or server
      // entry there would run with the user's rights the next time it is loaded.
      if (writes) {
        const parts = real.slice(realRoot.length).toLowerCase().split(sep).filter(Boolean);
        const last = parts[parts.length - 1] ?? '';
        if (parts.some((part) => PROTECTED_DIRS.has(part)) || PROTECTED_FILES.has(last)) {
          block(`${value} is a configuration file that chat is not allowed to change.`);
        }
      }
    }
    // File globs carry their own directory part, whatever `path` says: no "..",
    // and no absolute or home-relative start (including inside {a,b} alternatives).
    // Grep's `pattern` is a regex over file contents, so only its `glob` is checked.
    const escapes = (glob: unknown): boolean =>
      typeof glob === 'string' && (glob.includes('..') || /(^|[{,])\s*[\\/~]/.test(glob));
    if (escapes(params.glob) || (toolName !== 'Grep' && escapes(params.pattern))) {
      block('that file pattern reaches outside the project.');
    }
    process.exit(0);
  });
}

const MCP_NAME = 'designagent';
const TOOL_PREFIX = `mcp__${MCP_NAME}__`;

// Vars a parent Claude Code session exports. The broker is spawned from inside one,
// so without this the child would think it is a nested session of that parent.
const STRIP_ENV = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_PROJECT_DIR|CLAUDE_PLUGIN_ROOT|CLAUDE_CODE_(ENTRYPOINT|MESSAGING_SOCKET|MESSAGING_TOKEN|EXECPATH|SESSION_ID|CHILD_SESSION|SESSION_ATTENDED|CHILD_NOTES_DIR|SSE_PORT))$/;

const SYSTEM_APPEND = [
  'You are being driven from the DesignAgent panel inside Figma, not a terminal.',
  'The person typing is a designer looking at their Figma file.',
  `Act on the open file with the ${MCP_NAME} tools; call status first to see the file and the current selection.`,
  'After you change the design, take a screenshot to check the result.',
  'Reply in short plain sentences. No code or file paths unless asked. The panel is narrow: no tables.'
].join(' ');

function findClaude(): string {
  const override = process.env.DESIGNAGENT_CLAUDE_BIN?.trim();
  if (override) {
    return override;
  }
  const home = homedir();
  const candidates = [
    join(home, '.local', 'bin', 'claude'),
    join(home, '.claude', 'local', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude'
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return 'claude'; // fall back to PATH
}

export function createChatRunner(deps: {
  emit: (event: ChatEvent) => void;
  log: (...args: unknown[]) => void;
}): {
  send: (opts: ChatSendOptions) => void;
  stop: () => void;
  reset: () => void;
  busy: () => boolean;
} {
  let child: ChildProcess | null = null;
  // Claude Code session id per project root, for --resume on the next turn.
  const sessionByRoot = new Map<string, string>();

  function stop(): void {
    if (child) {
      try {
        child.kill('SIGTERM');
      } catch {
        // already gone
      }
    }
  }

  function send(opts: ChatSendOptions): void {
    if (child) {
      deps.emit({ kind: 'done', ok: false, error: 'Claude is still working on the last message.' });
      return;
    }
    const mcpConfig = JSON.stringify({
      mcpServers: {
        [MCP_NAME]: {
          command: process.execPath,
          args: [__filename],
          env: { DESIGNAGENT_PROJECT_DIR: opts.root }
        }
      }
    });
    // The prompt goes in on stdin, never argv, so text that starts with "-" can't be
    // read as a CLI flag. Built-in tools are cut down to file tools (no shell, no
    // web), and a PreToolUse hook (runChatGuard) keeps those inside the project.
    const guard = `"${process.execPath}" "${__filename}" --chat-guard`;
    const settings = JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: GUARDED_TOOLS.join('|'), hooks: [{ type: 'command', command: guard }] }]
      }
    });
    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--strict-mcp-config',
      '--mcp-config',
      mcpConfig,
      '--allowedTools',
      `mcp__${MCP_NAME}`,
      'Read',
      'Glob',
      'Grep',
      '--tools',
      [...GUARDED_TOOLS, 'ToolSearch'].join(','),
      '--settings',
      settings,
      '--append-system-prompt',
      SYSTEM_APPEND
    ];
    if (opts.allowEdits) {
      args.push('--permission-mode', 'acceptEdits');
    }
    const resume = sessionByRoot.get(opts.root);
    if (resume) {
      args.push('--resume', resume);
    }
    const model = process.env.DESIGNAGENT_CHAT_MODEL?.trim();
    if (model) {
      args.push('--model', model);
    }

    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (!STRIP_ENV.test(key)) {
        env[key] = value;
      }
    }
    env.DESIGNAGENT_CHAT_ROOT = opts.root;

    let proc: ChildProcess;
    try {
      proc = spawn(findClaude(), args, { cwd: opts.root, env, stdio: ['pipe', 'pipe', 'pipe'] });
      proc.stdin?.on('error', () => undefined);
      proc.stdin?.end(opts.text);
    } catch (error) {
      deps.emit({
        kind: 'done',
        ok: false,
        error: `Could not start Claude Code: ${error instanceof Error ? error.message : String(error)}`
      });
      return;
    }
    child = proc;
    deps.log(`chat: started claude (pid ${proc.pid}) in ${opts.root}${resume ? ' (resumed)' : ''}.`);
    deps.emit({ kind: 'start' });

    let finished = false;
    let buffer = '';
    let stderrTail = '';

    const finish = (event: ChatEvent): void => {
      if (finished) {
        return;
      }
      finished = true;
      deps.emit(event);
    };

    const handleLine = (line: string): void => {
      let evt: Record<string, unknown>;
      try {
        evt = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return;
      }
      if (typeof evt.session_id === 'string' && evt.session_id) {
        sessionByRoot.set(opts.root, evt.session_id);
      }
      if (evt.type === 'stream_event') {
        const inner = evt.event as { type?: string; delta?: { type?: string; text?: string }; content_block?: { type?: string; id?: string; name?: string } } | undefined;
        if (inner?.type === 'content_block_delta' && inner.delta?.type === 'text_delta' && inner.delta.text) {
          deps.emit({ kind: 'text', text: inner.delta.text });
        } else if (inner?.type === 'content_block_start' && inner.content_block?.type === 'tool_use') {
          const name = String(inner.content_block.name ?? 'tool');
          deps.emit({
            kind: 'tool',
            id: String(inner.content_block.id ?? ''),
            name: name.startsWith(TOOL_PREFIX) ? name.slice(TOOL_PREFIX.length) : name
          });
        } else if (inner?.type === 'message_stop') {
          // Separate the text of consecutive assistant messages.
          deps.emit({ kind: 'text', text: '\n\n' });
        }
        return;
      }
      if (evt.type === 'user') {
        const content = (evt.message as { content?: unknown } | undefined)?.content;
        if (Array.isArray(content)) {
          for (const block of content as Array<{ type?: string; tool_use_id?: string; is_error?: boolean }>) {
            if (block?.type === 'tool_result') {
              deps.emit({ kind: 'tool_done', id: String(block.tool_use_id ?? ''), ok: block.is_error !== true });
            }
          }
        }
        return;
      }
      if (evt.type === 'result') {
        const isError = evt.is_error === true || evt.subtype !== 'success';
        // The turn is over even though the process takes a moment to shut its MCP
        // servers down: free the slot now so the next message isn't refused.
        if (child === proc) {
          child = null;
        }
        setTimeout(() => {
          if (proc.exitCode === null && proc.signalCode === null) {
            proc.kill('SIGTERM');
          }
        }, 5000).unref();
        finish({
          kind: 'done',
          ok: !isError,
          error: isError ? String(evt.result ?? evt.subtype ?? 'Claude Code reported an error.') : undefined,
          costUsd: typeof evt.total_cost_usd === 'number' ? evt.total_cost_usd : undefined
        });
      }
    };

    proc.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          handleLine(line);
        }
        newline = buffer.indexOf('\n');
      }
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString('utf8')).slice(-600);
    });
    proc.on('error', (error: NodeJS.ErrnoException) => {
      if (child === proc) {
        child = null;
      }
      finish({
        kind: 'done',
        ok: false,
        error:
          error.code === 'ENOENT'
            ? 'Claude Code was not found on this machine. Install it, or set DESIGNAGENT_CLAUDE_BIN to its path.'
            : `Could not start Claude Code: ${error.message}`
      });
    });
    proc.on('close', (code, signal) => {
      if (child === proc) {
        child = null;
      }
      deps.log(`chat: claude exited (code ${code}, signal ${signal}).`);
      if (signal) {
        finish({ kind: 'done', ok: false, error: 'Stopped.' });
      } else {
        finish({
          kind: 'done',
          ok: false,
          error: stderrTail.trim() || `Claude Code exited with code ${code} before replying.`
        });
      }
    });
  }

  function reset(): void {
    stop();
    sessionByRoot.clear();
    deps.emit({ kind: 'reset' });
  }

  return { send, stop, reset, busy: () => child !== null };
}
