export const UI_STYLES = `
  :root {
    --bg: #f4f5f7;
    --surface: #ffffff;
    --surface-soft: #f6f7f9;
    --surface-hover: #eef0f3;
    --border: rgba(17, 18, 23, 0.09);
    --border-strong: rgba(17, 18, 23, 0.17);
    --text: #16171b;
    --text-muted: #5a5d66;
    --text-dim: #8c8f99;
    --primary-bg: #16171b;
    --primary-text: #ffffff;
    --primary-hover: #2c2e36;
    --accent: #16a34a;
    --accent-soft: rgba(22, 163, 74, 0.12);
    --ok: #15803d;
    --warn-bg: rgba(180, 120, 0, 0.10);
    --warn-border: rgba(180, 120, 0, 0.28);
    --warn-text: #8a5a00;
    --danger-bg: rgba(220, 38, 38, 0.07);
    --danger-border: rgba(220, 38, 38, 0.26);
    --danger-text: #b42318;
    --shadow: 0 1px 2px rgba(16, 24, 40, 0.05), 0 1px 1px rgba(16, 24, 40, 0.03);
    --skeleton-1: #ecedf1;
    --skeleton-2: #f5f6f8;
    --score-from: #22c55e;
    --score-to: #16a34a;
  }

  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0b0b0d;
      --surface: #16161a;
      --surface-soft: #1b1b1f;
      --surface-hover: #232328;
      --border: rgba(255, 255, 255, 0.09);
      --border-strong: rgba(255, 255, 255, 0.17);
      --text: #fafafa;
      --text-muted: #a8a8b3;
      --text-dim: #71717a;
      --primary-bg: #fafafa;
      --primary-text: #09090b;
      --primary-hover: #e4e4e7;
      --accent: #4ade80;
      --accent-soft: rgba(74, 222, 128, 0.14);
      --ok: #4ade80;
      --warn-bg: rgba(234, 179, 8, 0.10);
      --warn-border: rgba(234, 179, 8, 0.30);
      --warn-text: #facc15;
      --danger-bg: rgba(239, 68, 68, 0.10);
      --danger-border: rgba(239, 68, 68, 0.32);
      --danger-text: #fca5a5;
      --shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
      --skeleton-1: #1b1b1f;
      --skeleton-2: #26262b;
      --score-from: #22c55e;
      --score-to: #16a34a;
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
    padding: 16px;
    overflow: auto;
  }

  .app-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .app-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 2px 2px 0;
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

  button,
  input,
  textarea {
    font: inherit;
    font-family: inherit;
  }

  button {
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

  .btn-with-icon {
    display: inline-flex;
    align-items: center;
    gap: 5px;
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
    min-height: 38px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-muted);
    font-size: 13px;
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
    padding: 16px;
    box-shadow: var(--shadow);
  }

  .preset-grid {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 6px;
  }

  .preset-card {
    min-height: 66px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border-color: var(--border);
    background: var(--surface);
    color: var(--text-muted);
    padding: 8px 6px;
    box-shadow: var(--shadow);
  }

  .preset-card:hover {
    border-color: var(--border-strong);
    color: var(--text);
    background: var(--surface);
  }

  .preset-card.active {
    border-color: var(--text);
    color: var(--text);
    background: var(--surface);
  }

  .preset-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
  }

  .preset-label {
    font-size: 11.5px;
    line-height: 1.25;
    text-align: center;
    font-weight: 500;
  }

  .tab-nav {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
    margin-bottom: 2px;
  }

  .tab-btn {
    min-height: 32px;
    border-color: var(--border);
    background: var(--surface-soft);
    color: var(--text-muted);
    font-weight: 500;
    box-shadow: none;
  }

  .tab-btn.active {
    border-color: var(--border-strong);
    background: var(--surface);
    color: var(--text);
  }

  .meta-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 12px;
  }

  .score-meta-row {
    margin-top: 10px;
  }

  .score-meta-pills {
    display: inline-flex;
    align-items: center;
    gap: 8px;
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

  .link-required {
    margin-bottom: 4px;
    padding: 14px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--surface-soft);
  }

  .link-required-hint {
    margin: 0 0 10px;
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--text-muted);
  }

  .shortcut-inline {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: 4px;
    color: var(--text-dim);
  }

  .link-required-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
  }

  .warn-box {
    margin-bottom: 10px;
    padding: 10px 12px;
    border-radius: 9px;
    border: 1px solid var(--warn-border);
    background: var(--warn-bg);
    color: var(--warn-text);
    font-size: 12px;
    line-height: 1.5;
  }

  .warn-box + .warn-box {
    margin-top: -4px;
  }

  .warn-box strong {
    display: block;
    font-weight: 600;
    margin-bottom: 4px;
  }

  .prompt-label {
    font-size: 12px;
    color: var(--text-muted);
    margin-bottom: 8px;
  }

  .section-title {
    margin-top: 18px;
    margin-bottom: 8px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
    letter-spacing: 0.02em;
  }

  .section-subtitle {
    margin-top: 14px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text);
  }

  .hint-text {
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-dim);
    margin: 0 0 8px;
  }

  textarea {
    width: 100%;
    min-height: 300px;
    resize: vertical;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface-soft);
    color: var(--text);
    padding: 12px;
    font-size: 12px;
    line-height: 1.55;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }

  textarea:focus {
    outline: none;
    border-color: var(--border-strong);
    background: var(--surface);
  }

  input {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface-soft);
    color: var(--text);
    padding: 9px 11px;
    font-size: 12.5px;
  }

  input:focus {
    outline: none;
    border-color: var(--border-strong);
    background: var(--surface);
  }

  input::placeholder {
    color: var(--text-dim);
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

  .reason {
    font-size: 12px;
    color: var(--text-dim);
    margin-top: 2px;
    line-height: 1.5;
  }

  .ok-msg {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
    color: var(--ok);
    font-size: 12px;
    line-height: 1.5;
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

  .score-track {
    position: relative;
    height: 6px;
    background: var(--surface-soft);
    border-radius: 999px;
    border: 1px solid var(--border);
    overflow: hidden;
    margin: 10px 0;
  }

  .score-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--score-from) 0%, var(--score-to) 100%);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
    color: var(--text-muted);
  }

  th,
  td {
    border-bottom: 1px solid var(--border);
    padding: 8px 4px;
    text-align: left;
  }

  .check-item {
    position: relative;
    margin-top: 10px;
    padding: 10px 78px 0 0;
    border-top: 1px solid var(--border);
    font-size: 12.5px;
    color: var(--text-muted);
    line-height: 1.5;
  }

  .check-actions {
    margin-top: 8px;
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .issue-badge {
    position: absolute;
    top: 10px;
    right: 0;
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    border: 1px solid;
    padding: 2px 8px;
    font-size: 11.5px;
    line-height: 1.3;
  }

  .issue-badge.fixed {
    color: var(--ok);
    border-color: var(--accent-soft);
    background: var(--accent-soft);
  }

  .issue-badge.skipped {
    color: var(--warn-text);
    border-color: var(--warn-border);
    background: var(--warn-bg);
  }

  .json-view {
    margin-top: 8px;
    max-height: 280px;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface-soft);
    padding: 10px;
    font-size: 12px;
    line-height: 1.45;
    color: var(--text-muted);
    white-space: pre-wrap;
    word-break: break-word;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
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
    min-height: 240px;
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
    max-width: 360px;
    font-size: 12.5px;
    line-height: 1.6;
    margin: 0;
  }

  .loading-panel {
    padding: 16px;
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

  .bridge-panel {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .bridge-status-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .bridge-status {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
  }

  .bridge-dot {
    width: 9px;
    height: 9px;
    border-radius: 999px;
    flex: none;
  }

  .bridge-explainer {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.55;
    color: var(--text-muted);
  }

  .bridge-caps {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .bridge-cap {
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--surface-soft);
    padding: 9px 11px;
  }

  .bridge-cap-label {
    display: block;
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
  }

  .bridge-cap-detail {
    display: block;
    margin-top: 2px;
    font-size: 11px;
    line-height: 1.4;
    color: var(--text-dim);
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

  @media (max-width: 520px) {
    .preset-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
`;
