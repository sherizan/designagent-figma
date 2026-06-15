import React from 'react';
import { Frame } from 'lucide-react';

export type MainTab = 'design-to-code' | 'code-to-design';

interface AppHeaderProps {
  version: string;
}

export function AppHeader({ version }: AppHeaderProps): JSX.Element {
  return (
    <div className="app-header">
      <div className="header-copy">
        <h1 className="title">DesignAgent</h1>
        <p className="sub">Design ↔ code, both directions.</p>
      </div>
      <div className="version-tag">{version}</div>
    </div>
  );
}

export type BridgeStatus = 'off' | 'connecting' | 'connected' | 'error';

interface BridgeBarProps {
  status: BridgeStatus;
  enabled: boolean;
  onToggle: () => void;
}

const BRIDGE_META: Record<BridgeStatus, { color: string; label: string }> = {
  off: { color: '#9f9faa', label: 'Claude bridge off' },
  connecting: { color: '#e0a83d', label: 'Claude bridge — connecting…' },
  connected: { color: '#3bba6d', label: 'Claude bridge — connected' },
  error: { color: '#e0653d', label: 'Claude bridge — retrying…' }
};

// Global, always-visible connection bar — the bridge powers both directions, so it
// lives at the app level rather than inside a tab.
export function BridgeBar({ status, enabled, onToggle }: BridgeBarProps): JSX.Element {
  const meta = BRIDGE_META[status];
  return (
    <div className="bridge-bar">
      <div className="bridge-bar-row">
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
        <button type="button" className={enabled ? 'btn' : 'btn-primary'} onClick={onToggle}>
          {enabled ? 'Disable' : 'Enable'}
        </button>
      </div>

      <details className="bridge-setup">
        <summary>Setup</summary>
        <ol className="bridge-steps">
          <li>
            In Claude Code: <code>/plugin marketplace add sherizan/designagent-figma</code>
          </li>
          <li>
            <code>/plugin install designagent@designagent</code>, then restart Claude Code.
          </li>
          <li>
            Click <strong>Enable</strong> above — the dot turns green when connected.
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
    { id: 'design-to-code', label: 'Design → Code' },
    { id: 'code-to-design', label: 'Code → Design' }
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

interface ExportPanelProps {
  intentLabel: string;
  selectedNodeName: string;
  status: string;
  hasImageAsset: boolean;
  imageSizeKb?: number;
  onExportDesignMd: () => void;
  onExportHtml: () => void;
  onSavePng: () => void;
}

export function ExportPanel(props: ExportPanelProps): JSX.Element {
  const {
    intentLabel,
    selectedNodeName,
    status,
    hasImageAsset,
    imageSizeKb,
    onExportDesignMd,
    onExportHtml,
    onSavePng
  } = props;

  return (
    <div className="panel">
      <div className="meta-row">
        <div className="selection-group">
          <span className="badge">{intentLabel}</span>
          <div className="selection-name-inline">{selectedNodeName}</div>
        </div>
      </div>

      <p className="export-hint">Turn this selection into something you can build from.</p>

      <div className="export-actions">
        <button type="button" className="export-card" onClick={onExportDesignMd}>
          <span className="export-card-title">Export DESIGN.md</span>
          <span className="export-card-sub">
            Structured Markdown spec — tokens, components, layout, text. Drop it in your repo and
            add <code>@DESIGN.md</code> to CLAUDE.md.
          </span>
        </button>
        <button type="button" className="export-card" onClick={onExportHtml}>
          <span className="export-card-title">Export HTML</span>
          <span className="export-card-sub">
            Self-contained HTML + CSS starter built from the design’s computed styles.
          </span>
        </button>
      </div>

      <div className="prompt-actions">
        {status ? <span className="status-pill">{status}</span> : null}
        {hasImageAsset ? (
          <button
            type="button"
            className="btn"
            onClick={onSavePng}
            title={imageSizeKb ? `Save exported PNG (${imageSizeKb} KB)` : 'Save exported PNG'}
          >
            Save PNG
          </button>
        ) : null}
      </div>
    </div>
  );
}

const BRIDGE_CAPABILITIES: Array<{ label: string; detail: string }> = [
  { label: 'Read', detail: 'spec · score · DESIGN.md · issues' },
  { label: 'Build', detail: 'frames · text · shapes · images' },
  { label: 'Style', detail: 'fills · strokes · radius · shadow · type' },
  { label: 'Layout', detail: 'move · resize · group · clone · delete' }
];

// Code → Design tab content. The HTML → Design paste box is added here in Part B.
export function CapabilityView(): JSX.Element {
  return (
    <div className="panel">
      <p className="bridge-explainer">
        With the bridge connected, Claude Code can act on this Figma file directly:
      </p>
      <div className="bridge-caps">
        {BRIDGE_CAPABILITIES.map((cap) => (
          <div key={cap.label} className="bridge-cap">
            <span className="bridge-cap-label">{cap.label}</span>
            <span className="bridge-cap-detail">{cap.detail}</span>
          </div>
        ))}
      </div>
      <p className="prompt-hint">
        Claude can also render HTML into Figma over the bridge (e.g. “render index.html into
        Figma”). Browsing your project’s HTML files here is coming next.
      </p>
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
      Built by Sherizan ·{' '}
      <a href="https://www.designagent.dev" target="_blank" rel="noreferrer">
        DesignAgent.dev
      </a>
    </div>
  );
}
