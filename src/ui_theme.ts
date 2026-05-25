export const UI_STYLES = `
  :root {
    --bg: #0b0b0d;
    --surface: #131316;
    --surface-soft: #18181b;
    --surface-hover: #1d1d21;
    --border: #232328;
    --border-strong: #2d2d33;
    --text: #fafafa;
    --text-muted: #a1a1aa;
    --text-dim: #71717a;
    --primary-bg: #fafafa;
    --primary-text: #09090b;
    --accent: #86efac;
    --warn-bg: rgba(234, 179, 8, 0.08);
    --warn-border: rgba(234, 179, 8, 0.3);
    --warn-text: #facc15;
    --danger-bg: rgba(239, 68, 68, 0.08);
    --danger-border: rgba(239, 68, 68, 0.32);
    --danger-text: #fca5a5;
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

  .panel {
    border: 1px solid var(--border);
    background: var(--surface);
    border-radius: 10px;
    padding: 14px;
  }

  .header-panel {
    padding-bottom: 12px;
  }

  .header-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 12px;
  }

  .header-copy {
    min-width: 0;
  }

  .title {
    margin: 0;
    font-size: 15px;
    line-height: 1.25;
    font-weight: 600;
    letter-spacing: -0.005em;
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
    border-radius: 7px;
    background: transparent;
    color: var(--text-muted);
    padding: 7px 11px;
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
    border-color: var(--text-dim);
    color: var(--text);
    background: var(--surface-hover);
  }

  button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .btn-primary {
    background: var(--primary-bg);
    border-color: var(--primary-bg);
    color: var(--primary-text);
    font-weight: 600;
  }

  .btn-primary:hover {
    background: #e4e4e7;
    border-color: #e4e4e7;
    color: var(--primary-text);
  }

  .preset-grid {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 6px;
  }

  .preset-card {
    min-height: 68px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border-color: var(--border);
    background: var(--surface-soft);
    color: var(--text-muted);
    padding: 8px 6px;
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
    margin-bottom: 4px;
  }

  .tab-btn {
    min-height: 32px;
    border-color: var(--border);
    background: var(--surface-soft);
    color: var(--text-muted);
    font-weight: 500;
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
    margin-bottom: 10px;
  }

  .score-meta-row {
    margin-top: 10px;
  }

  .badge {
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 2px 9px;
    font-size: 10.5px;
    font-weight: 500;
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
    font-weight: 500;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .link-required {
    margin-bottom: 10px;
    padding: 12px;
    border-radius: 8px;
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

  .link-required-row input {
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
  }

  .link-required-row input:focus {
    outline: none;
    border-color: var(--border-strong);
  }

  .link-required-row input::placeholder {
    color: var(--text-dim);
  }

  .warn-box {
    margin-bottom: 8px;
    padding: 10px;
    border-radius: 8px;
    border: 1px solid var(--warn-border);
    background: var(--warn-bg);
    color: var(--warn-text);
    font-size: 12px;
    line-height: 1.5;
  }

  .warn-box + .warn-box {
    margin-top: -2px;
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
    margin-top: 12px;
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
    min-height: 320px;
    resize: vertical;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--text-muted);
    padding: 12px;
    font-size: 12px;
    line-height: 1.55;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }

  textarea:focus {
    outline: none;
    border-color: var(--border-strong);
  }

  input {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--bg);
    color: var(--text);
    padding: 8px 10px;
    font-size: 12.5px;
  }

  input:focus {
    outline: none;
    border-color: var(--border-strong);
  }

  .prompt-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
    justify-content: flex-end;
    flex-wrap: wrap;
  }

  .prompt-hint {
    margin: 8px 0 0;
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

  .pro-lock {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 12.5px;
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
    color: #4ade80;
    font-size: 12px;
    line-height: 1.5;
  }

  details {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface-soft);
    padding: 10px;
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
    margin: 8px 0;
  }

  .score-fill {
    height: 100%;
    background: linear-gradient(90deg, #22c55e 0%, #16a34a 100%);
    opacity: 0.95;
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
    padding: 7px 4px;
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
    color: #4ade80;
    border-color: rgba(74, 222, 128, 0.4);
    background: rgba(74, 222, 128, 0.08);
  }

  .issue-badge.skipped {
    color: #f59e0b;
    border-color: rgba(245, 158, 11, 0.4);
    background: rgba(245, 158, 11, 0.08);
  }

  .json-view {
    margin-top: 8px;
    max-height: 280px;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    padding: 10px;
    font-size: 12px;
    line-height: 1.45;
    color: var(--text-muted);
    white-space: pre-wrap;
    word-break: break-word;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }

  .error {
    margin-bottom: 8px;
    border: 1px solid var(--danger-border);
    background: var(--danger-bg);
    color: var(--danger-text);
    border-radius: 8px;
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
    min-height: 260px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 24px 16px;
    color: var(--text-muted);
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
      var(--surface-soft) 0%,
      var(--surface-hover) 40%,
      var(--surface-soft) 80%
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

  .panel-footer {
    margin-top: auto;
    text-align: center;
    font-size: 11px;
    color: var(--text-dim);
    padding: 8px 0;
  }

  .panel-footer a {
    color: var(--accent);
    text-decoration: none;
    opacity: 0.85;
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
