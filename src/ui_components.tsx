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

// The app's top bar — styled like a header (flat, no card). It's the Claude
// Bridge title + live status, with Start/Stop and a Setup disclosure.
export function BridgeBar({
  status,
  enabled,
  lastHeartbeatAt,
  onToggle,
  onReconnect
}: BridgeBarProps): JSX.Element {
  const meta = BRIDGE_META[status];
  // Setup starts open and collapses once the bridge is connected; the user can
  // still toggle it manually, and it re-opens if the connection drops.
  const [setupOpen, setSetupOpen] = React.useState(true);
  React.useEffect(() => {
    setSetupOpen(status !== 'connected');
  }, [status]);
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
            {status === 'connected' && lastHeartbeatAt !== null ? (
              <HeartbeatReadout at={lastHeartbeatAt} />
            ) : null}
          </div>
        </div>
        <div className="bridge-actions">
          {enabled ? (
            <button type="button" className="btn" onClick={onReconnect}>
              Reconnect
            </button>
          ) : null}
          <button type="button" className={enabled ? 'btn' : 'btn-primary'} onClick={onToggle}>
            {enabled ? 'Stop' : 'Start'}
          </button>
        </div>
      </div>

      <details
        className="bridge-setup"
        open={setupOpen}
        onToggle={(event) => setSetupOpen(event.currentTarget.open)}
      >
        <summary>Setup</summary>
        <ol className="bridge-steps">
          <li>
            In Claude Code: <code>/plugin marketplace add sherizan/designagent-figma</code>
          </li>
          <li>
            <code>/plugin install designagent@designagent</code>, then restart Claude Code.
          </li>
          <li>
            Click <strong>Start</strong> above — the dot turns green when connected.
          </li>
        </ol>
      </details>
    </div>
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
      <span className="version-tag">v1.14.4</span> · Built by Sherizan ·{' '}
      <a href="https://www.designagent.dev" target="_blank" rel="noreferrer">
        DesignAgent.dev
      </a>
    </div>
  );
}
