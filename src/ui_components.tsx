import React from 'react';
import { Frame } from 'lucide-react';

export type MainTab = 'design-to-code' | 'code-to-design';

export type BridgeStatus = 'off' | 'connecting' | 'connected' | 'error';

interface BridgeBarProps {
  status: BridgeStatus;
  enabled: boolean;
  lastHeartbeatAt: number | null;
  onToggle: () => void;
  onReconnect: () => void;
}

const BRIDGE_META: Record<BridgeStatus, { color: string; label: string }> = {
  off: { color: '#9f9faa', label: 'Off' },
  connecting: { color: '#e0a83d', label: 'Connecting…' },
  connected: { color: '#3bba6d', label: 'Connected' },
  error: { color: '#e0653d', label: 'Retrying…' }
};

function formatAgo(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s ago`;
}

// Live "Ns ago" readout for the last bridge heartbeat — distinguishes a truly
// live cross-process bridge from a stale/half-open socket showing green.
function HeartbeatReadout({ at }: { at: number }): JSX.Element {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <span className="bridge-heartbeat">heartbeat {formatAgo(at, now)}</span>;
}

const INSTALL_COMMANDS = [
  '/plugin marketplace add sherizan/designagent',
  '/plugin install designagent@designagent'
];

// Figma's UI iframe sometimes denies the async clipboard API; fall back to execCommand.
function copyText(text: string): void {
  const legacy = (): void => {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand('copy');
    } catch {
      // nothing else to try
    }
    document.body.removeChild(area);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(legacy);
  } else {
    legacy();
  }
}

function CopyCommand({ command }: { command: string }): JSX.Element {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="bridge-cmd">
      <code>{command}</code>
      <button
        type="button"
        className="btn btn-xs"
        onClick={() => {
          copyText(command);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

// The app's top bar: title + live status. Reconnect / Stop are rarely needed, so
// they live behind a small menu; when the bridge is off the only action is Start.
export function BridgeBar({
  status,
  enabled,
  lastHeartbeatAt,
  onToggle,
  onReconnect
}: BridgeBarProps): JSX.Element {
  const meta = BRIDGE_META[status];
  const [menuOpen, setMenuOpen] = React.useState(false);
  return (
    <div className="bridge-bar">
      <div className="bridge-bar-row">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ↔
          </span>
          <div className="header-copy">
            <h1 className="title">Claude Bridge</h1>
            <span className="bridge-status">
              <span
                className="bridge-dot"
                aria-hidden="true"
                style={{
                  backgroundColor: meta.color,
                  boxShadow: status === 'connected' ? `0 0 0 3px ${meta.color}33` : 'none'
                }}
              />
              <span>{meta.label}</span>
            </span>
          </div>
        </div>
        <div className="bridge-actions">
          {enabled ? (
            <div className="bridge-menu">
              <button
                type="button"
                className="btn bridge-menu-button"
                aria-label="Bridge options"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
              >
                ⋯
              </button>
              {menuOpen ? (
                <div className="bridge-menu-list" role="menu">
                  {status === 'connected' && lastHeartbeatAt !== null ? (
                    <HeartbeatReadout at={lastHeartbeatAt} />
                  ) : null}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onReconnect();
                    }}
                  >
                    Reconnect
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onToggle();
                    }}
                  >
                    Stop
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <button type="button" className="btn-primary" onClick={onToggle}>
              Start
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Shown only when the bridge can't reach Claude Code: the first-time install steps.
export function SetupCard(): JSX.Element {
  return (
    <div className="panel">
      <div className="section-subtitle" style={{ marginTop: 0 }}>
        Connect Claude Code
      </div>
      <p className="bridge-setup-lead">
        DesignAgent can't find Claude Code with its plugin. First time? Run these once in Claude Code:
      </p>
      {INSTALL_COMMANDS.map((command) => (
        <CopyCommand key={command} command={command} />
      ))}
      <p className="bridge-setup-lead">
        Then run <code>claude</code> inside your project folder. This panel connects on its own.
      </p>
    </div>
  );
}

// "0.23.0" < "0.25.0". Anything unparseable (or missing: a pre-0.19 plugin) is older.
export function isOlderVersion(candidate: string, reference: string): boolean {
  const parse = (v: string): number[] | null => {
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
  };
  const ref = parse(reference);
  if (!ref) {
    return false;
  }
  const cand = parse(candidate);
  if (!cand) {
    return true;
  }
  for (let i = 0; i < 3; i++) {
    if (cand[i]! !== ref[i]!) {
      return cand[i]! < ref[i]!;
    }
  }
  return false;
}

// One line, shown only when the Claude Code plugin is older than this panel.
export function UpdateBanner({ from }: { from: string }): JSX.Element {
  return (
    <details className="update-banner">
      <summary>
        Update available{from ? ` · Claude Code plugin ${from} → ${__PLUGIN_VERSION__}` : ''}
      </summary>
      <ol className="bridge-steps">
        <li>
          In Claude Code: <code>/plugins</code>, find <strong>designagent</strong>, choose{' '}
          <strong>Update now</strong> (or enable auto-updates).
        </li>
        <li>
          Run <code>/reload-plugins</code>.
        </li>
      </ol>
    </details>
  );
}

interface MainTabsProps {
  active: MainTab;
  onChange: (tab: MainTab) => void;
}

export function MainTabs({ active, onChange }: MainTabsProps): JSX.Element {
  const tabs: Array<{ id: MainTab; label: string }> = [
    { id: 'code-to-design', label: 'Code → Design' },
    { id: 'design-to-code', label: 'Design → Code' }
  ];
  return (
    <div className="main-tabs" role="tablist" aria-label="DesignAgent mode">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          className={`main-tab ${active === tab.id ? 'active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export interface SessionInfo {
  id: string;
  label: string;
  root: string;
  selected: boolean;
  pluginVersion: string;
}

interface ProjectPickerProps {
  sessions: SessionInfo[];
  onSelect: (id: string) => void;
  variant: 'gate' | 'compact';
}

export function ProjectPicker({ sessions, onSelect, variant }: ProjectPickerProps): JSX.Element {
  if (variant === 'compact') {
    const current = sessions.find((s) => s.selected) ?? sessions[0];
    return (
      <div className="project-switch">
        <span className="project-switch-label">Project</span>
        {sessions.length > 1 ? (
          <select
            className="project-switch-select"
            value={current?.id ?? ''}
            onChange={(e) => onSelect(e.target.value)}
            aria-label="Active project"
          >
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="project-switch-current" title={current?.root}>
            {current?.label}
          </span>
        )}
      </div>
    );
  }
  return (
    <div className="panel project-gate" role="region" aria-label="Choose a project">
      <div className="section-subtitle" style={{ marginTop: 0 }}>
        Choose a project
      </div>
      <p className="bridge-explainer" style={{ marginTop: 6 }}>
        Several Claude sessions are connected. Pick which project DesignAgent reads &amp; writes.
      </p>
      <div className="project-gate-list">
        {sessions.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`project-gate-item ${s.selected ? 'selected' : ''}`}
            onClick={() => onSelect(s.id)}
          >
            <span className="project-gate-name">{s.label}</span>
            <span className="project-gate-path">{s.root}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

interface ExportPanelProps {
  intentLabel: string;
  selectedNodeName: string;
  status: string;
  bridgeConnected: boolean;
  designChecked: boolean;
  designExists: boolean;
  designRoot: string;
  onSyncDesignMd: () => void;
  onApplyToFigma: () => void;
  onExportDesignMd: () => void;
  onExportHtml: () => void;
}

export function ExportPanel(props: ExportPanelProps): JSX.Element {
  const {
    intentLabel,
    selectedNodeName,
    status,
    bridgeConnected,
    designChecked,
    designExists,
    designRoot,
    onSyncDesignMd,
    onApplyToFigma,
    onExportDesignMd,
    onExportHtml
  } = props;

  // Confirm-first before overwriting an existing DESIGN.md.
  const [confirming, setConfirming] = React.useState(false);
  React.useEffect(() => setConfirming(false), [designExists, selectedNodeName]);

  return (
    <div className="panel">
      <div className="meta-row">
        <div className="selection-group">
          <span className="badge">{intentLabel}</span>
          <div className="selection-name-inline">{selectedNodeName}</div>
        </div>
      </div>

      {bridgeConnected ? (
        <div className="designmd-sync">
          <div className="designmd-sync-info">
            <span className="designmd-sync-title">
              {designExists ? 'DESIGN.md in your project' : 'No DESIGN.md yet'}
            </span>
            <span className="designmd-sync-path">
              {designRoot
                ? designExists
                  ? `${designRoot}/DESIGN.md`
                  : `Will create in ${designRoot}`
                : 'Checking project…'}
            </span>
          </div>
          {designExists ? (
            confirming ? (
              <div className="designmd-sync-confirm">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    setConfirming(false);
                    onSyncDesignMd();
                  }}
                >
                  Confirm overwrite
                </button>
                <button type="button" className="btn" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </div>
            ) : (
              <div className="designmd-sync-confirm">
                <button
                  type="button"
                  className="btn"
                  onClick={onApplyToFigma}
                  title="Apply DESIGN.md tokens into this Figma file"
                >
                  Apply
                </button>
                <button type="button" className="btn-primary" onClick={() => setConfirming(true)}>
                  Update
                </button>
              </div>
            )
          ) : (
            <button
              type="button"
              className="btn-primary"
              onClick={onSyncDesignMd}
              disabled={!designChecked}
            >
              Create
            </button>
          )}
        </div>
      ) : null}

      <p className="export-hint">Turn this selection into something you can build from.</p>

      <div className="export-actions">
        <button type="button" className="export-card" onClick={onExportDesignMd}>
          <span className="export-card-title">Export DESIGN.md</span>
          <span className="export-card-sub">
            Token frontmatter + guidance, following the <code>design.md</code> spec. Drop it in your
            repo and add <code>@DESIGN.md</code> to CLAUDE.md.
          </span>
        </button>
        <button type="button" className="export-card" onClick={onExportHtml}>
          <span className="export-card-title">Export HTML</span>
          <span className="export-card-sub">
            Self-contained HTML + CSS starter built from the design’s computed styles.
          </span>
        </button>
      </div>

      {status ? (
        <div className="prompt-actions">
          <span className="status-pill">{status}</span>
        </div>
      ) : null}
    </div>
  );
}

// Code → Design tab content: a short two-step instruction. The HTML file
// browser (port Claude's artifacts) renders below it in ui.tsx.
export function CapabilityView(): JSX.Element {
  return (
    <div className="panel">
      <ol className="how-list">
        <li>
          In your terminal, open your project and run <code>claude</code>.
        </li>
        <li>
          Ask for what you want — <strong>“design a button”</strong> — and it shows up here.
        </li>
      </ol>
    </div>
  );
}

export interface HtmlFileEntry {
  path: string;
  name: string;
  dir: string;
  size: number;
}

interface HtmlBrowserProps {
  connected: boolean;
  listFiles: () => Promise<{ root: string; files: HtmlFileEntry[] }>;
  renderFile: (path: string) => Promise<{ ok: boolean; result?: unknown; error?: string }>;
  projectKey?: string;
}

export function HtmlBrowser({ connected, listFiles, renderFile, projectKey }: HtmlBrowserProps): JSX.Element {
  const [files, setFiles] = React.useState<HtmlFileEntry[]>([]);
  const [root, setRoot] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [rendering, setRendering] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState('');

  const refresh = React.useCallback(async () => {
    if (!connected) return;
    setLoading(true);
    setStatus('');
    try {
      const result = await listFiles();
      setRoot(result.root);
      setFiles(result.files);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to list files');
    } finally {
      setLoading(false);
    }
  }, [connected, listFiles, projectKey]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!connected) {
    return (
      <div className="panel">
        <div className="section-subtitle" style={{ marginTop: 0 }}>
          Port Claude’s HTML artifacts
        </div>
        <p className="bridge-explainer" style={{ marginTop: 6 }}>
          Turn on the bridge above to render Claude’s HTML files here.
        </p>
      </div>
    );
  }

  const onRender = async (path: string) => {
    setRendering(path);
    setStatus('');
    try {
      const result = await renderFile(path);
      setStatus(result.ok ? `Rendered ${path}` : `Failed: ${result.error ?? 'unknown error'}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Render failed');
    } finally {
      setRendering(null);
      setTimeout(() => setStatus(''), 3000);
    }
  };

  return (
    <div className="panel">
      <div className="meta-row">
        <div className="section-subtitle" style={{ marginTop: 0 }}>
          Port Claude’s HTML artifacts
        </div>
        <button type="button" className="btn" onClick={() => void refresh()} disabled={loading}>
          {loading ? '…' : 'Refresh'}
        </button>
      </div>
      {root ? (
        <p className="html-file-dir" style={{ marginTop: 2 }}>
          Scanning: {root}
        </p>
      ) : null}
      {status ? <p className="prompt-hint">{status}</p> : null}
      {files.length === 0 ? (
        <p className="bridge-explainer">
          {loading
            ? 'Scanning project…'
            : 'No .html files in this folder yet. Save Claude’s HTML here, then Refresh.'}
        </p>
      ) : (
        <div className="html-file-list">
          {files.map((file) => (
            <div key={file.path} className="html-file">
              <div className="html-file-info">
                <span className="html-file-name">{file.name}</span>
                {file.dir !== '.' ? <span className="html-file-dir">{file.dir}</span> : null}
              </div>
              <button
                type="button"
                className="btn"
                onClick={() => void onRender(file.path)}
                disabled={rendering !== null}
              >
                {rendering === file.path ? 'Rendering…' : 'Render'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface LoadingPanelProps {
  nodeName: string;
  nodeType: string;
}

export function LoadingPanel({ nodeName, nodeType }: LoadingPanelProps): JSX.Element {
  return (
    <div className="panel loading-panel" aria-busy="true" aria-live="polite">
      <div className="loading-header">
        <span className="loading-spinner" aria-hidden="true" />
        <div className="loading-text">
          <div className="loading-title">Analyzing {nodeName}</div>
          <div className="loading-sub">
            {nodeType.toLowerCase()} — extracting CSS, variables, annotations…
          </div>
        </div>
      </div>
      <div className="skeleton-stack" aria-hidden="true">
        <div className="skeleton-row sk-1" />
        <div className="skeleton-row sk-2" />
        <div className="skeleton-row sk-3" />
        <div className="skeleton-row sk-4" />
        <div className="skeleton-row sk-5" />
      </div>
    </div>
  );
}

interface EmptyStateProps {
  message: string;
}

export function EmptyState({ message }: EmptyStateProps): JSX.Element {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        <Frame size={56} strokeWidth={1.8} />
      </div>
      <p className="empty-state-text">{message}</p>
    </div>
  );
}

export function Footer(): JSX.Element {
  return (
    <div className="panel-footer">
      <span className="version-tag">v{__PLUGIN_VERSION__}</span> · Built by Sherizan ·{' '}
      <a href="https://www.designagent.dev" target="_blank" rel="noreferrer">
        DesignAgent.dev
      </a>
    </div>
  );
}

// ---- In-panel chat (prototype) ----
// The broker runs the user's own Claude Code headless and streams it here.

export type ChatPart =
  | { type: 'text'; text: string }
  | { type: 'tool'; id: string; name: string; state: 'running' | 'ok' | 'error' };

export interface ChatMessage {
  role: 'user' | 'assistant';
  parts: ChatPart[];
  error?: string;
}

const TOOL_LABELS: Record<string, string> = {
  status: 'Checking the file',
  take_screenshot: 'Looking at the design',
  get_spec: 'Reading the selection',
  get_design_md: 'Reading the design spec',
  list_page_nodes: 'Reading the page',
  list_variables_and_styles: 'Reading variables and styles',
  html_to_design: 'Building the layout',
  batch: 'Making several edits',
  ToolSearch: 'Finding the right tool',
  Read: 'Reading a project file',
  Glob: 'Searching the project',
  Grep: 'Searching the project',
  Edit: 'Editing a project file',
  Write: 'Writing a project file'
};

function toolLabel(name: string): string {
  const known = TOOL_LABELS[name];
  if (known) {
    return known;
  }
  const words = name.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Just enough markdown for chat replies: **bold** and `code`.
function renderInline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g).map((piece, index) => {
    if (piece.length > 4 && piece.startsWith('**') && piece.endsWith('**')) {
      return <strong key={index}>{piece.slice(2, -2)}</strong>;
    }
    if (piece.length > 2 && piece.startsWith('`') && piece.endsWith('`')) {
      return <code key={index}>{piece.slice(1, -1)}</code>;
    }
    return <React.Fragment key={index}>{piece}</React.Fragment>;
  });
}

const CHAT_SUGGESTIONS = [
  'Tidy the spacing in my selection',
  'Rename the layers in my selection',
  'Design a pricing card next to my selection'
];

interface ChatPanelProps {
  messages: ChatMessage[];
  paired: boolean;
  onPair: (code: string) => void;
  busy: boolean;
  projectLabel: string;
  allowEdits: boolean;
  onAllowEditsChange: (value: boolean) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  onReset: () => void;
}

export function ChatPanel({
  messages,
  paired,
  onPair,
  busy,
  projectLabel,
  allowEdits,
  onAllowEditsChange,
  onSend,
  onStop,
  onReset
}: ChatPanelProps): JSX.Element {
  const [draft, setDraft] = React.useState('');
  const listRef = React.useRef<HTMLDivElement | null>(null);

  // Keep the newest text in view while the reply streams in.
  React.useEffect(() => {
    const list = listRef.current;
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  }, [messages, busy]);

  const [codeDraft, setCodeDraft] = React.useState('');
  const [confirmEdits, setConfirmEdits] = React.useState(false);

  if (!paired) {
    return (
      <div className="chat">
        <p className="bridge-explainer">
          Chat here instead of the terminal. Pair this panel with your Claude Code once: run this in a
          terminal, then paste the code.
        </p>
        <CopyCommand command={'pbcopy < ~/.designagent-chat-code && echo "Code copied. Paste it in the DesignAgent panel in Figma."'} />
        <div className="chat-input">
          <textarea
            value={codeDraft}
            rows={1}
            placeholder="Paste pairing code"
            onChange={(event) => setCodeDraft(event.target.value)}
          />
          <button
            type="button"
            className="btn-primary"
            disabled={codeDraft.trim().length < 32}
            onClick={() => onPair(codeDraft.trim())}
          >
            Pair
          </button>
        </div>
      </div>
    );
  }

  const submit = (text: string): void => {
    const trimmed = text.trim();
    if (!trimmed || busy) {
      return;
    }
    onSend(trimmed);
    setDraft('');
  };

  return (
    <div className="chat">
      {messages.length === 0 ? (
        <div className="chat-empty">
          <p className="bridge-explainer">
            Ask Claude to read or change this file. It runs your own Claude Code
            {projectLabel ? (
              <>
                {' '}
                in <strong>{projectLabel}</strong>
              </>
            ) : null}
            .
          </p>
          <div className="chat-suggestions">
            {CHAT_SUGGESTIONS.map((suggestion) => (
              <button key={suggestion} type="button" className="chat-suggestion" onClick={() => submit(suggestion)}>
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="chat-list" ref={listRef}>
          {messages.map((message, index) => {
            const isLast = index === messages.length - 1;
            const empty = message.parts.every((part) => part.type === 'text' && !part.text.trim());
            return (
              <div key={index} className={`chat-msg chat-msg-${message.role}`}>
                {message.parts.map((part, partIndex) =>
                  part.type === 'text' ? (
                    part.text.trim() ? (
                      <div key={partIndex} className="chat-text">
                        {renderInline(part.text.trim())}
                      </div>
                    ) : null
                  ) : (
                    <div key={partIndex} className={`chat-tool chat-tool-${part.state}`}>
                      <span className="chat-tool-mark" aria-hidden="true">
                        {part.state === 'running' ? '' : part.state === 'ok' ? '✓' : '!'}
                      </span>
                      <span>{toolLabel(part.name)}</span>
                    </div>
                  )
                )}
                {message.role === 'assistant' && isLast && busy && empty ? (
                  <div className="chat-tool chat-tool-running">
                    <span className="chat-tool-mark" aria-hidden="true" />
                    <span>Starting Claude Code…</span>
                  </div>
                ) : null}
                {message.error ? <div className="chat-error">{message.error}</div> : null}
              </div>
            );
          })}
        </div>
      )}

      <div className="chat-input">
        <textarea
          value={draft}
          rows={2}
          placeholder="Ask Claude about this file…"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit(draft);
            }
          }}
        />
        {busy ? (
          <button type="button" className="btn" onClick={onStop}>
            Stop
          </button>
        ) : (
          <button type="button" className="btn-primary" disabled={!draft.trim()} onClick={() => submit(draft)}>
            Send
          </button>
        )}
      </div>

      <div className="chat-options">
        {confirmEdits ? (
          <span className="chat-check">
            <span>Claude will change files in {projectLabel || 'your project'} without asking.</span>
            <button
              type="button"
              className="chat-link"
              onClick={() => {
                onAllowEditsChange(true);
                setConfirmEdits(false);
              }}
            >
              Allow
            </button>
            <button type="button" className="chat-link" onClick={() => setConfirmEdits(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <label className="chat-check">
            <input
              type="checkbox"
              checked={allowEdits}
              onChange={(event) => (event.target.checked ? setConfirmEdits(true) : onAllowEditsChange(false))}
            />
            <span>Let Claude edit my files</span>
          </label>
        )}
        {messages.length > 0 ? (
          <button type="button" className="chat-link" disabled={busy} onClick={onReset}>
            New chat
          </button>
        ) : null}
      </div>
    </div>
  );
}
