import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  PRESET_DEFINITIONS,
  SCORE_CATEGORIES,
  type AnalysisResult,
  type Preset,
  type ScoreCategory,
  type ScoreResult
} from './core/types';
import type { ToUIMessage } from './shared/messages';

const INITIAL_ANALYSIS: AnalysisResult = {
  hasSelection: false,
  preset: 'nextjs-tailwind-shadcn',
  message: 'Select a frame, instance, or section to begin.'
};

const CATEGORY_MAX: Record<ScoreCategory, number> = {
  'Component Coverage': 30,
  'Tokenization Coverage': 25,
  'Layout Semantics': 20,
  'Naming + Semantics': 15,
  'Variant Completeness': 10
};

function postPluginMessage(message: unknown): void {
  parent.postMessage({ pluginMessage: message }, '*');
}

async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fallback below.
  }

  const textArea = document.createElement('textarea');
  textArea.value = value;
  textArea.style.position = 'fixed';
  textArea.style.opacity = '0';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  const copied = document.execCommand('copy');
  document.body.removeChild(textArea);
  return copied;
}

function formatBreakdownRow(score: ScoreResult, category: ScoreCategory): string {
  switch (category) {
    case 'Component Coverage':
      return `${score.breakdown.componentCoverage}/${CATEGORY_MAX[category]}`;
    case 'Tokenization Coverage':
      return `${score.breakdown.tokenizationCoverage}/${CATEGORY_MAX[category]}`;
    case 'Layout Semantics':
      return `${score.breakdown.layoutSemantics}/${CATEGORY_MAX[category]}`;
    case 'Naming + Semantics':
      return `${score.breakdown.namingSemantics}/${CATEGORY_MAX[category]}`;
    case 'Variant Completeness':
      return `${score.breakdown.variantCompleteness}/${CATEGORY_MAX[category]}`;
    default:
      return '0';
  }
}

function App(): JSX.Element {
  const [preset, setPreset] = useState<Preset>('nextjs-tailwind-shadcn');
  const [analysis, setAnalysis] = useState<AnalysisResult>(INITIAL_ANALYSIS);
  const [error, setError] = useState<string>('');
  const [copyPromptStatus, setCopyPromptStatus] = useState<string>('');
  const [copyJsonStatus, setCopyJsonStatus] = useState<string>('');

  useEffect(() => {
    const listener = (event: MessageEvent<{ pluginMessage?: ToUIMessage }>) => {
      const message = event.data.pluginMessage;
      if (!message) {
        return;
      }

      if (message.type === 'ANALYSIS_RESULT') {
        setError('');
        setAnalysis(message.payload);
        setPreset(message.payload.preset);
        return;
      }

      if (message.type === 'ERROR') {
        setError(message.message);
      }
    };

    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, []);

  const scorePercent = useMemo(() => {
    if (!analysis.hasSelection) {
      return 0;
    }
    return Math.max(0, Math.min(100, analysis.score.total));
  }, [analysis]);

  const onPresetChange = (value: Preset) => {
    setPreset(value);
    postPluginMessage({ type: 'SET_PRESET', preset: value });
  };

  const onCopyPrompt = async () => {
    if (!analysis.hasSelection) {
      return;
    }
    const copied = await copyText(analysis.prompt);
    setCopyPromptStatus(copied ? 'Copied' : 'Copy failed');
    setTimeout(() => setCopyPromptStatus(''), 1300);
  };

  const onCopyJson = async () => {
    if (!analysis.hasSelection) {
      return;
    }
    const copied = await copyText(JSON.stringify(analysis.uiSpec, null, 2));
    setCopyJsonStatus(copied ? 'Copied' : 'Copy failed');
    setTimeout(() => setCopyJsonStatus(''), 1300);
  };

  return (
    <div className="app-shell">
      <style>{`
        :root {
          color-scheme: light;
          --bg-1: #fffaf2;
          --bg-2: #f3efe4;
          --panel: #fffdf8;
          --line: #e5dcc8;
          --ink: #1f2418;
          --muted: #4a5240;
          --accent: #1a8060;
          --warn: #9b5f00;
          --bad: #9b2020;
          --chip-bg: #e2f4eb;
          --chip-fg: #0d5d45;
        }

        * {
          box-sizing: border-box;
        }

        body {
          font-family: "IBM Plex Sans", "Avenir Next", "Segoe UI", sans-serif;
          color: var(--ink);
        }

        .app-shell {
          height: 100%;
          overflow: auto;
          background: radial-gradient(circle at 20% 0%, var(--bg-2), var(--bg-1) 42%);
          padding: 14px;
        }

        .panel {
          border: 1px solid var(--line);
          background: var(--panel);
          border-radius: 12px;
          padding: 12px;
          margin-bottom: 10px;
          box-shadow: 0 8px 22px rgba(50, 54, 37, 0.06);
        }

        .header-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }

        .title {
          margin: 0;
          font-size: 16px;
          font-weight: 700;
          letter-spacing: 0.02em;
        }

        .sub {
          margin: 3px 0 0;
          color: var(--muted);
          font-size: 12px;
        }

        .controls {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 8px;
          margin-top: 10px;
        }

        select,
        button,
        textarea {
          font: inherit;
        }

        select {
          width: 100%;
          border-radius: 8px;
          border: 1px solid var(--line);
          padding: 8px;
          background: #fffeff;
        }

        button {
          border-radius: 8px;
          border: 1px solid #adc8b6;
          background: #effbf5;
          color: #0d4d38;
          padding: 8px 10px;
          cursor: pointer;
          font-weight: 600;
        }

        button:active {
          transform: translateY(1px);
        }

        .meta {
          display: grid;
          gap: 4px;
          font-size: 12px;
        }

        .badge {
          display: inline-flex;
          align-items: center;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 700;
          padding: 3px 8px;
          color: var(--chip-fg);
          background: var(--chip-bg);
          width: fit-content;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .score-track {
          position: relative;
          height: 8px;
          border-radius: 999px;
          background: #ebe6d7;
          overflow: hidden;
          margin: 8px 0 10px;
        }

        .score-fill {
          height: 100%;
          background: linear-gradient(90deg, #cb5e2f, #d99831, #2a946d);
          transition: width 0.2s ease;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
        }

        th,
        td {
          border-bottom: 1px solid #efe9da;
          padding: 6px 4px;
          text-align: left;
        }

        details {
          border: 1px solid #eee5d3;
          border-radius: 8px;
          padding: 8px;
          margin-bottom: 8px;
          background: #fffefb;
        }

        summary {
          cursor: pointer;
          font-weight: 600;
          color: #273121;
        }

        .check-item {
          margin-top: 8px;
          padding-top: 8px;
          border-top: 1px solid #f1ead9;
          font-size: 12px;
        }

        .check-item:first-child {
          border-top: none;
          margin-top: 4px;
          padding-top: 0;
        }

        .reason {
          color: var(--muted);
          margin-top: 2px;
        }

        .suggestion {
          margin-top: 2px;
          color: #224836;
        }

        textarea {
          width: 100%;
          min-height: 180px;
          resize: vertical;
          border-radius: 8px;
          border: 1px solid #e0d7c2;
          padding: 8px;
          font-family: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace;
          font-size: 11px;
          line-height: 1.5;
          background: #fffdf6;
        }

        pre {
          font-family: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace;
          font-size: 11px;
          line-height: 1.4;
          white-space: pre-wrap;
          word-break: break-word;
          margin: 8px 0 0;
          max-height: 260px;
          overflow: auto;
          border: 1px solid #eee3cf;
          border-radius: 8px;
          padding: 8px;
          background: #fffef9;
        }

        .status-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
          gap: 8px;
        }

        .status-pill {
          font-size: 11px;
          color: #2b5f49;
          font-weight: 700;
        }

        .error {
          font-size: 12px;
          color: var(--bad);
          margin-bottom: 8px;
        }

        .empty {
          color: var(--warn);
          font-size: 12px;
        }
      `}</style>

      <div className="panel">
        <div className="header-row">
          <div>
            <h1 className="title">DesignAgent</h1>
            <p className="sub">Deterministic extraction, scoring, and build prompt</p>
          </div>
          <button type="button" onClick={() => postPluginMessage({ type: 'REFRESH_REQUEST' })}>
            Refresh
          </button>
        </div>

        <div className="controls">
          <select
            value={preset}
            onChange={(event) => onPresetChange(event.target.value as Preset)}
            aria-label="Preset"
          >
            {Object.values(PRESET_DEFINITIONS).map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? <div className="error">{error}</div> : null}

      {analysis.hasSelection ? (
        <>
          <div className="panel">
            <div className="status-row">
              <strong>Selected Node</strong>
              <span className="badge">{analysis.intent}</span>
            </div>
            <div className="meta">
              <span>
                <strong>Name:</strong> {analysis.selectedNode.name}
              </span>
              <span>
                <strong>ID:</strong> {analysis.selectedNode.id}
              </span>
              <span>
                <strong>Type:</strong> {analysis.selectedNode.type}
              </span>
              <span>
                <strong>Size:</strong>{' '}
                {typeof analysis.selectedNode.width === 'number' &&
                typeof analysis.selectedNode.height === 'number'
                  ? `${Math.round(analysis.selectedNode.width)} x ${Math.round(analysis.selectedNode.height)}`
                  : 'N/A'}
              </span>
              <span>
                <strong>Mode:</strong> {analysis.mode === 'fidelity' ? 'Fidelity mode' : 'System-first'}
              </span>
            </div>
          </div>

          <div className="panel">
            <div className="status-row">
              <strong>AI-ready Score</strong>
              <span className="status-pill">{analysis.score.total}/100</span>
            </div>
            <div className="score-track">
              <div className="score-fill" style={{ width: `${scorePercent}%` }} />
            </div>

            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Score</th>
                </tr>
              </thead>
              <tbody>
                {SCORE_CATEGORIES.map((category) => (
                  <tr key={category}>
                    <td>{category}</td>
                    <td>{formatBreakdownRow(analysis.score, category)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="panel">
            <strong>Checklist</strong>
            {SCORE_CATEGORIES.map((category) => {
              const items = analysis.checklistByCategory[category] ?? [];
              return (
                <details key={category} open={items.length > 0}>
                  <summary>
                    {category} ({items.length})
                  </summary>
                  {items.length === 0 ? (
                    <div className="reason">No fixes required in this category.</div>
                  ) : (
                    items.map((item) => (
                      <div key={`${item.nodeId}-${item.reason}`} className="check-item">
                        <div>
                          <strong>{item.nodeName}</strong> ({item.nodeId})
                        </div>
                        <div className="reason">{item.reason}</div>
                        <div className="suggestion">{item.suggestion}</div>
                      </div>
                    ))
                  )}
                </details>
              );
            })}
          </div>

          <div className="panel">
            <div className="status-row">
              <strong>Build Prompt</strong>
              <div>
                <button type="button" onClick={onCopyPrompt}>
                  Copy Prompt
                </button>
                {copyPromptStatus ? <span className="status-pill"> {copyPromptStatus}</span> : null}
              </div>
            </div>
            <textarea readOnly value={analysis.prompt} />
          </div>

          <div className="panel">
            <details>
              <summary>uiSpec JSON</summary>
              <div className="status-row">
                <span className="sub">Normalized deterministic extraction output</span>
                <div>
                  <button type="button" onClick={onCopyJson}>
                    Copy JSON
                  </button>
                  {copyJsonStatus ? <span className="status-pill"> {copyJsonStatus}</span> : null}
                </div>
              </div>
              <pre>{JSON.stringify(analysis.uiSpec, null, 2)}</pre>
            </details>
          </div>
        </>
      ) : (
        <div className="panel empty">{analysis.message}</div>
      )}
    </div>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Missing root element');
}

createRoot(rootElement).render(<App />);
