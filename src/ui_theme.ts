export const UI_STYLES = `
  /* DesignAgent brand — warm paper + Claude coral (see designagent.dev / site/DESIGN.md).
     Coral #d97757 is the single accent; surfaces are warm paper, ink is warm near-black. */
  :root {
    --bg: #faf7f2;
    --surface: #ffffff;
    --surface-soft: #f5f0e8;
    --surface-hover: #efe8dc;
    --border: #ece4d6;
    --border-strong: #dccfba;
    --text: #23201c;
    --text-muted: #6f675b;
    --text-dim: #9a9184;
    --primary-bg: #d97757;
    --primary-text: #ffffff;
    --primary-hover: #c8643f;
    --accent: #c2603a;
    --accent-soft: rgba(217, 119, 87, 0.12);
    --ok: #15803d;
    --danger-bg: rgba(196, 99, 74, 0.08);
    --danger-border: rgba(196, 99, 74, 0.30);
    --danger-text: #b34a30;
    --shadow: 0 1px 2px rgba(35, 32, 28, 0.06), 0 1px 1px rgba(35, 32, 28, 0.04);
    --skeleton-1: #ece5d9;
    --skeleton-2: #f5f1ea;
  }

  /* Warm-dark variant: the paper inverts to warm ink, coral stays the accent. */
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #1a1613;
      --surface: #23201c;
      --surface-soft: #2a2621;
      --surface-hover: #332e28;
      --border: rgba(250, 247, 242, 0.10);
      --border-strong: rgba(250, 247, 242, 0.20);
      --text: #faf7f2;
      --text-muted: #b4a99b;
      --text-dim: #8c857a;
      --primary-bg: #d97757;
      --primary-text: #ffffff;
      --primary-hover: #e4895f;
      --accent: #e58a68;
      --accent-soft: rgba(217, 119, 87, 0.20);
      --ok: #4ade80;
      --danger-bg: rgba(232, 140, 120, 0.12);
      --danger-border: rgba(232, 140, 120, 0.32);
      --danger-text: #ef9d86;
      --shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
      --skeleton-1: #2a2621;
      --skeleton-2: #353029;
    }
  }

  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: system-ui, -apple-system, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }

  .app-shell {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    padding: 14px;
    overflow: auto;
  }

  .app-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .app-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 2px 2px 0;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .brand-mark {
    flex: none;
    width: 24px;
    height: 24px;
    border-radius: 7px;
    background: var(--primary-bg);
    color: var(--primary-text);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    line-height: 1;
    box-shadow: 0 1px 2px rgba(217, 119, 87, 0.35);
  }

  .header-copy {
    min-width: 0;
  }

  .title {
    margin: 0;
    font-size: 15px;
    line-height: 1.2;
    font-weight: 650;
    letter-spacing: -0.01em;
    color: var(--text);
  }

  .sub {
    margin: 3px 0 0;
    font-size: 12px;
    line-height: 1.4;
    color: var(--text-muted);
  }

  .version-tag {
    font-size: 10.5px;
    font-weight: 500;
    color: var(--text-dim);
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: 999px;
    flex-shrink: 0;
    align-self: center;
  }

  button {
    font: inherit;
    font-family: inherit;
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text-muted);
    padding: 7px 12px;
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
    transition: border-color 120ms ease, color 120ms ease, background-color 120ms ease;
  }

  button:hover {
    border-color: var(--border-strong);
    color: var(--text);
    background: var(--surface-hover);
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary {
    background: var(--primary-bg);
    border-color: var(--primary-bg);
    color: var(--primary-text);
    font-weight: 600;
  }

  .btn-primary:hover {
    background: var(--primary-hover);
    border-color: var(--primary-hover);
    color: var(--primary-text);
  }

  .main-tabs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
    padding: 4px;
    background: var(--surface-soft);
    border: 1px solid var(--border);
    border-radius: 12px;
  }

  .main-tab {
    min-height: 36px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-muted);
    font-size: 12.5px;
    font-weight: 600;
    border-radius: 9px;
  }

  .main-tab:hover {
    background: transparent;
    border-color: transparent;
    color: var(--text);
  }

  .main-tab.active {
    background: var(--surface);
    color: var(--text);
    border-color: var(--border);
    box-shadow: var(--shadow);
  }

  .panel {
    border: 1px solid var(--border);
    background: var(--surface);
    border-radius: 12px;
    padding: 14px;
    box-shadow: var(--shadow);
  }

  .meta-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 12px;
  }

  .badge {
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 2px 9px;
    font-size: 10.5px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .selection-group {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1;
  }

  .selection-name-inline {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .section-subtitle {
    margin-top: 14px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text);
  }

  .prompt-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
    justify-content: flex-end;
    flex-wrap: wrap;
  }

  .prompt-hint {
    margin: 10px 0 0;
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--text-dim);
  }

  .prompt-hint strong {
    color: var(--text-muted);
    font-weight: 600;
  }

  .status-pill {
    font-size: 11.5px;
    color: var(--text-muted);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }

  details {
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface-soft);
    padding: 12px;
    margin-top: 8px;
  }

  summary {
    cursor: pointer;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text);
  }

  .error {
    border: 1px solid var(--danger-border);
    background: var(--danger-bg);
    color: var(--danger-text);
    border-radius: 10px;
    padding: 10px 12px;
    font-size: 12.5px;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    line-height: 1.5;
  }

  .error a {
    color: inherit;
    text-decoration: none;
    white-space: nowrap;
    font-weight: 600;
  }

  .error a:hover {
    text-decoration: underline;
  }

  .empty-state {
    min-height: 220px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 28px 16px;
    color: var(--text-muted);
    border: 1px dashed var(--border-strong);
    border-radius: 12px;
    background: var(--surface);
  }

  .empty-state-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 12px;
    color: var(--text-dim);
    opacity: 0.8;
  }

  .empty-state-text {
    max-width: 300px;
    font-size: 12.5px;
    line-height: 1.6;
    margin: 0;
  }

  .loading-panel {
    padding: 14px;
  }

  .loading-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 14px;
  }

  .loading-spinner {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 1.5px solid var(--border-strong);
    border-top-color: var(--text);
    animation: da-spin 720ms linear infinite;
    flex-shrink: 0;
  }

  @keyframes da-spin {
    to { transform: rotate(360deg); }
  }

  .loading-text {
    min-width: 0;
    flex: 1;
  }

  .loading-title {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .loading-sub {
    font-size: 11.5px;
    color: var(--text-dim);
    margin-top: 2px;
  }

  .skeleton-stack {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .skeleton-row {
    height: 10px;
    border-radius: 4px;
    background: linear-gradient(
      90deg,
      var(--skeleton-1) 0%,
      var(--skeleton-2) 40%,
      var(--skeleton-1) 80%
    );
    background-size: 200% 100%;
    animation: da-shimmer 1.4s ease-in-out infinite;
  }

  .skeleton-row.sk-1 { width: 92%; }
  .skeleton-row.sk-2 { width: 76%; }
  .skeleton-row.sk-3 { width: 88%; }
  .skeleton-row.sk-4 { width: 64%; }
  .skeleton-row.sk-5 { width: 80%; }

  @keyframes da-shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  .bridge-explainer {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.55;
    color: var(--text-muted);
  }

  .how-list {
    margin: 0;
    padding-left: 20px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    font-size: 13px;
    line-height: 1.55;
    color: var(--text-muted);
  }

  .how-list li::marker {
    color: var(--text-dim);
    font-weight: 600;
  }

  .how-list strong {
    color: var(--text);
    font-weight: 600;
  }

  .how-list code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    background: var(--surface-soft);
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 1px 6px;
    color: var(--text);
  }

  .bridge-setup {
    margin-top: 0;
  }

  .bridge-steps {
    margin: 10px 0 0;
    padding-left: 18px;
    display: flex;
    flex-direction: column;
    gap: 7px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-muted);
  }

  .bridge-steps code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11.5px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 1px 5px;
    color: var(--text);
  }

  .bridge-bar {
    border: 1px solid var(--border);
    background: var(--surface);
    border-radius: 10px;
    padding: 10px 12px;
    box-shadow: var(--shadow);
  }

  .bridge-bar-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .bridge-bar .bridge-setup {
    margin-top: 10px;
    border: none;
    background: transparent;
    padding: 0;
  }

  .bridge-status {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text);
    min-width: 0;
  }

  .bridge-status span:last-child {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .bridge-dot {
    width: 9px;
    height: 9px;
    border-radius: 999px;
    flex: none;
  }

  .export-hint {
    margin: 0 0 12px;
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--text-muted);
  }

  .export-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .export-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 3px;
    text-align: left;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface-soft);
    box-shadow: none;
  }

  .export-card:hover {
    border-color: var(--border-strong);
    background: var(--surface);
  }

  .export-card-title {
    font-size: 13px;
    font-weight: 650;
    color: var(--text);
  }

  .export-card-sub {
    font-size: 11.5px;
    line-height: 1.45;
    color: var(--text-dim);
    font-weight: 400;
  }

  .export-card code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0 4px;
  }

  .html-file-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 8px;
  }

  .html-file {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--surface-soft);
    padding: 8px 11px;
  }

  .html-file-info {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .html-file-name {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .html-file-dir {
    font-size: 11px;
    color: var(--text-dim);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }

  .panel-footer {
    margin-top: auto;
    text-align: center;
    font-size: 11px;
    color: var(--text-dim);
    padding: 10px 0 2px;
  }

  .panel-footer a {
    color: var(--accent);
    text-decoration: none;
    opacity: 0.9;
  }

  .panel-footer a:hover {
    opacity: 1;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
`;
