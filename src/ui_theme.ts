export const UI_STYLES = `
  :root {
    --bg: #0e0e0f;
    --surface: #111113;
    --surface-soft: #151518;
    --border: #27272a;
    --border-strong: #3f3f46;
    --text: #fafafa;
    --text-muted: #a1a1aa;
    --text-dim: #52525b;
    --primary-bg: #fafafa;
    --primary-text: #09090b;
    --link-color: #86efac;
    --hero-bg-image: none;
    --warn-bg: rgba(234, 179, 8, 0.09);
    --warn-border: rgba(234, 179, 8, 0.3);
    --warn-text: #facc15;
  }

  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: "SF Pro Display", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
      Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  .app-shell {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    padding: 12px;
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
    padding: 12px;
    margin-bottom: 10px;
  }

  .header-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 10px;
    position: relative;
    z-index: 2;
  }

  .hero-panel {
    position: relative;
    overflow: hidden;
    background-image:
      radial-gradient(110% 100% at 0% 0%, rgba(134, 239, 172, 0.18) 0%, rgba(17, 17, 19, 0) 55%),
      radial-gradient(110% 100% at 100% 0%, rgba(56, 189, 248, 0.18) 0%, rgba(17, 17, 19, 0) 58%),
      linear-gradient(145deg, #11131a 0%, #101014 48%, #0f1117 100%),
      var(--hero-bg-image);
    background-size: cover;
    background-position: center;
  }

  .hero-copy {
    max-width: 460px;
  }

  .hero-eyebrow {
    display: inline-flex;
    margin-bottom: 8px;
    font-size: 11px;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: #93c5fd;
    border: 1px solid rgba(147, 197, 253, 0.35);
    border-radius: 999px;
    padding: 3px 8px;
    background: rgba(147, 197, 253, 0.08);
  }

  .hero-version {
    font-size: 11px;
    letter-spacing: 0.06em;
    color: rgba(255, 255, 255, 0.75);
    padding: 6px 10px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 999px;
    text-transform: uppercase;
    align-self: flex-start;
  }

  .hero-bg-shape {
    position: absolute;
    border-radius: 999px;
    filter: blur(28px);
    opacity: 0.42;
    pointer-events: none;
    z-index: 1;
  }

  .hero-bg-shape-a {
    width: 160px;
    height: 160px;
    right: -30px;
    top: -44px;
    background: rgba(74, 222, 128, 0.26);
  }

  .hero-bg-shape-b {
    width: 150px;
    height: 150px;
    right: 108px;
    top: -62px;
    background: rgba(59, 130, 246, 0.24);
  }

  .title {
    margin: 0;
    font-size: 14px;
    line-height: 1.2;
    letter-spacing: -0.01em;
    font-weight: 600;
    color: var(--text);
  }

  .sub {
    margin: 4px 0 0;
    font-size: 12px;
    line-height: 1.4;
    color: var(--text-muted);
  }

  button,
  input,
  textarea {
    font: inherit;
  }

  button {
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    background: transparent;
    color: var(--text-muted);
    padding: 7px 10px;
    font-size: 12px;
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
    border-color: #52525b;
    color: var(--text);
  }

  button:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }

  .btn-primary {
    background: var(--primary-bg);
    border-color: var(--primary-bg);
    color: var(--primary-text);
    font-weight: 600;
  }

  .btn-primary:hover {
    border-color: #e4e4e7;
    background: #e4e4e7;
    color: var(--primary-text);
  }

  .preset-grid {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 6px;
  }

  .tab-nav {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
    margin-bottom: 10px;
  }

  .tab-btn {
    min-height: 34px;
    border-color: var(--border);
    background: var(--surface-soft);
    color: var(--text-muted);
    font-weight: 600;
  }

  .tab-btn.active {
    border-color: var(--text);
    background: var(--surface);
    color: var(--text);
  }

  .preset-card {
    min-height: 84px;
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
    font-size: 12px;
    line-height: 1.3;
    text-align: center;
  }

  .meta-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
  }

  .score-meta-row {
    margin-top: 8px;
  }

  .badge {
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    padding: 2px 8px;
    font-size: 12px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .selection-group {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1;
  }

  .selection-name-inline {
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .mcp-link {
    font-size: 12px;
    color: #86efac;
    text-decoration: none;
    border-bottom: 1px solid rgba(134, 239, 172, 0.45);
    padding-bottom: 1px;
    white-space: nowrap;
  }

  .mcp-link:hover {
    color: #bbf7d0;
    border-bottom-color: rgba(187, 247, 208, 0.75);
  }

  .link-required {
    margin-bottom: 10px;
    padding: 10px;
    border-radius: 8px;
    border: 1px solid rgba(96, 165, 250, 0.35);
    background: rgba(59, 130, 246, 0.08);
  }

  .link-required-hint {
    margin: 0 0 8px;
    font-size: 12px;
    line-height: 1.5;
    color: #cbd5e1;
  }

  .shortcut-inline {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: 4px;
  }

  .link-required-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
  }

  .link-required-row input {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
  }

  .link-required-row input::placeholder {
    color: var(--text-dim);
  }

  .warn-box {
    margin-bottom: 8px;
    padding: 8px;
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

  .prompt-label {
    font-size: 12px;
    color: var(--text-muted);
    margin-bottom: 8px;
  }

  .section-title {
    margin-top: 20px;
    margin-bottom: 8px;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.06em;
    color: var(--text);
  }

  .section-subtitle {
    margin-top: 12px;
    font-size: 13px;
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
    min-height: 340px;
    resize: vertical;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--text-muted);
    padding: 10px;
    font-size: 12px;
    line-height: 1.5;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }

  input {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--text-muted);
    padding: 8px;
    font-size: 12px;
  }

  .prompt-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
    justify-content: flex-end;
  }

  .status-pill {
    font-size: 12px;
    color: var(--text-muted);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }

  .pro-lock {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 12px;
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
    padding: 8px;
    margin-top: 8px;
  }

  summary {
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
  }

  .score-track {
    position: relative;
    height: 6px;
    background: #18181b;
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
    font-size: 12px;
    color: var(--text-muted);
  }

  th,
  td {
    border-bottom: 1px solid var(--border);
    padding: 6px 4px;
    text-align: left;
  }

  .check-item {
    position: relative;
    margin-top: 8px;
    padding: 8px 72px 0 0;
    border-top: 1px solid var(--border);
    font-size: 12px;
    color: var(--text-muted);
  }

  .check-actions {
    margin-top: 6px;
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .issue-badge {
    position: absolute;
    top: 8px;
    right: 0;
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    border: 1px solid;
    padding: 2px 8px;
    font-size: 12px;
    line-height: 1.3;
  }

  .issue-badge.fixed {
    color: #4ade80;
    border-color: rgba(74, 222, 128, 0.45);
    background: rgba(74, 222, 128, 0.09);
  }

  .issue-badge.skipped {
    color: #f59e0b;
    border-color: rgba(245, 158, 11, 0.45);
    background: rgba(245, 158, 11, 0.09);
  }

  .json-view {
    margin-top: 8px;
    max-height: 280px;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    padding: 8px;
    font-size: 12px;
    line-height: 1.4;
    color: var(--text-muted);
    white-space: pre-wrap;
    word-break: break-word;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }

  .error {
    margin-bottom: 8px;
    border: 1px solid rgba(239, 68, 68, 0.35);
    background: rgba(239, 68, 68, 0.09);
    color: #fca5a5;
    border-radius: 8px;
    padding: 8px;
    font-size: 12px;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
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
    min-height: 280px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 20px 16px;
    color: var(--text-muted);
  }

  .empty-state-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 12px;
    color: var(--text);
    opacity: 0.9;
  }

  .empty-state-text {
    max-width: 360px;
    font-size: 12px;
    line-height: 1.6;
    margin: 0;
  }

  .panel-footer {
    margin-top: auto;
    text-align: center;
    font-size: 11px;
    color: var(--text-dim);
    padding: 6px 0;
  }

  .panel-footer a {
    color: var(--link-color);
    text-decoration: none;
  }

  .panel-footer a:hover {
    text-decoration: underline;
  }

  @media (max-width: 520px) {
    .preset-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
`;
