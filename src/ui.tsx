import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Apple,
  Bot,
  CheckCircle2,
  Eye,
  FileCode,
  Frame,
  Globe,
  Smartphone,
  StickyNote,
  Undo2,
  type LucideIcon
} from 'lucide-react';
import {
  PRESET_DEFINITIONS,
  SCORE_CATEGORIES,
  type AnalysisResult,
  type ChecklistItem,
  type PresetIcon,
  type Preset,
  type ScoreCategory,
  type ScoreResult
} from './core/types';
import type { ToUIMessage } from './shared/messages';

const INITIAL_ANALYSIS: AnalysisResult = {
  hasSelection: false,
  preset: 'nextjs-tailwind-shadcn',
  mode: 'system-first',
  flowCapable: false,
  message: 'Select a frame, instance, or section to generate a contextual prompt.'
};

const PRESET_ORDER: Preset[] = [
  'swiftui-ios',
  'jetpack-compose-android',
  'react-native-expo-nativewind',
  'nextjs-tailwind-shadcn',
  'web-html-css'
];

const CATEGORY_MAX: Record<ScoreCategory, number> = {
  'Component Coverage': 30,
  'Tokenization Coverage': 25,
  'Layout Semantics': 20,
  'Naming + Semantics': 15,
  'Variant Completeness': 10
};

const CATEGORY_PLAIN_LABELS: Record<ScoreCategory, string> = {
  'Component Coverage': 'Uses components',
  'Tokenization Coverage': 'Uses tokens/styles',
  'Layout Semantics': 'Layout clarity',
  'Naming + Semantics': 'Layer naming clarity',
  'Variant Completeness': 'Variant setup'
};

const PRESET_ICON_COMPONENTS: Record<PresetIcon, LucideIcon> = {
  globe: Globe,
  smartphone: Smartphone,
  'file-code': FileCode,
  apple: Apple,
  bot: Bot
};

function postPluginMessage(message: unknown): void {
  parent.postMessage({ pluginMessage: message }, '*');
}

async function copyText(value: string): Promise<boolean> {
  if (!value) {
    return false;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // fallback below
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

function toIntentLabel(intent: 'screen' | 'component' | 'section'): string {
  if (intent === 'screen') {
    return 'Screen';
  }

  if (intent === 'component') {
    return 'Component';
  }

  return 'Section';
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

function plainCategoryLabel(category: ScoreCategory): string {
  return CATEGORY_PLAIN_LABELS[category];
}

function getCategoryScore(score: ScoreResult, category: ScoreCategory): number {
  switch (category) {
    case 'Component Coverage':
      return score.breakdown.componentCoverage;
    case 'Tokenization Coverage':
      return score.breakdown.tokenizationCoverage;
    case 'Layout Semantics':
      return score.breakdown.layoutSemantics;
    case 'Naming + Semantics':
      return score.breakdown.namingSemantics;
    case 'Variant Completeness':
      return score.breakdown.variantCompleteness;
    default:
      return 0;
  }
}

function issueKey(item: {
  category: string;
  nodeId: string;
  reason: string;
}): string {
  return `${item.category}:${item.nodeId}:${item.reason}`;
}

function App(): JSX.Element {
  const [preset, setPreset] = useState<Preset>('nextjs-tailwind-shadcn');
  const [analysis, setAnalysis] = useState<AnalysisResult>(INITIAL_ANALYSIS);
  const [error, setError] = useState<string>('');
  const [copyStatus, setCopyStatus] = useState<string>('');
  const [issueFixState, setIssueFixState] = useState<
    Record<string, { status: 'fixed' | 'skipped'; detail: string }>
  >({});

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
        if (message.payload.hasSelection) {
          const activeKeys = new Set(
            message.payload.checklist.map((item) => issueKey(item))
          );
          setIssueFixState((current) =>
            Object.fromEntries(
              Object.entries(current).filter(([key]) => activeKeys.has(key))
            )
          );
        } else {
          setIssueFixState({});
        }
        return;
      }

      if (message.type === 'ISSUE_FIX_RESULT') {
        const key = issueKey(message);
        setIssueFixState((current) => ({
          ...current,
          [key]: {
            status: message.status,
            detail: message.detail
          }
        }));
        return;
      }

      if (message.type === 'ERROR') {
        setError(message.message);
      }
    };

    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, []);

  const skippedIssueKeys = useMemo(
    () =>
      new Set(
        Object.entries(issueFixState)
          .filter(([, value]) => value.status === 'skipped')
          .map(([key]) => key)
      ),
    [issueFixState]
  );

  const adjustedScoreBreakdown = useMemo(() => {
    if (!analysis.hasSelection) {
      return null;
    }

    const next: Record<ScoreCategory, number> = {
      'Component Coverage': getCategoryScore(analysis.score, 'Component Coverage'),
      'Tokenization Coverage': getCategoryScore(analysis.score, 'Tokenization Coverage'),
      'Layout Semantics': getCategoryScore(analysis.score, 'Layout Semantics'),
      'Naming + Semantics': getCategoryScore(analysis.score, 'Naming + Semantics'),
      'Variant Completeness': getCategoryScore(analysis.score, 'Variant Completeness')
    };

    for (const category of SCORE_CATEGORIES) {
      const originalItems = analysis.checklistByCategory[category] ?? [];
      if (originalItems.length === 0) {
        continue;
      }

      const skippedInCategory = originalItems.filter((item) =>
        skippedIssueKeys.has(issueKey(item))
      ).length;
      if (skippedInCategory === 0) {
        continue;
      }

      const categoryMax = CATEGORY_MAX[category];
      const skippedGain = (categoryMax * skippedInCategory) / originalItems.length;
      next[category] = Math.min(categoryMax, Math.round(next[category] + skippedGain));
    }

    return next;
  }, [analysis, skippedIssueKeys]);

  const adjustedScoreTotal = useMemo(() => {
    if (!analysis.hasSelection || !adjustedScoreBreakdown) {
      return 0;
    }
    return SCORE_CATEGORIES.reduce((sum, category) => sum + adjustedScoreBreakdown[category], 0);
  }, [analysis, adjustedScoreBreakdown]);

  const scorePercent = useMemo(() => {
    if (!analysis.hasSelection) {
      return 0;
    }

    return Math.max(0, Math.min(100, adjustedScoreTotal));
  }, [analysis, adjustedScoreTotal]);

  const onSelectPreset = (nextPreset: Preset) => {
    setPreset(nextPreset);
    postPluginMessage({ type: 'SET_PRESET', preset: nextPreset });
  };

  const onCopyPrompt = async () => {
    if (!analysis.hasSelection) {
      return;
    }

    const copied = await copyText(analysis.prompt);
    setCopyStatus(copied ? 'Copied' : 'Copy failed');
    setTimeout(() => setCopyStatus(''), 1400);
  };

  const onFocusItem = (item: ChecklistItem) => {
    postPluginMessage({ type: 'FOCUS_NODE', nodeId: item.nodeId });
    setCopyStatus('Focused');
    setTimeout(() => setCopyStatus(''), 1600);
  };

  const onAddAnnotation = (item: ChecklistItem) => {
    postPluginMessage({
      type: 'ADD_ANNOTATION',
      nodeId: item.nodeId,
      nodeName: item.nodeName,
      category: item.category,
      reason: item.reason,
      suggestion: item.suggestion
    });
    setCopyStatus('Annotation added');
    setTimeout(() => setCopyStatus(''), 1600);
  };

  const onSkipIssue = (item: ChecklistItem) => {
    const key = issueKey(item);
    setIssueFixState((current) => ({
      ...current,
      [key]: {
        status: 'skipped',
        detail: 'Skipped by user.'
      }
    }));
    setCopyStatus('Issue skipped');
    setTimeout(() => setCopyStatus(''), 1600);
  };

  return (
    <div className="app-shell">
      <style>{`
        :root {
          --bg: #09090b;
          --surface: #111113;
          --surface-soft: #151518;
          --border: #27272a;
          --border-strong: #3f3f46;
          --text: #fafafa;
          --text-muted: #a1a1aa;
          --text-dim: #52525b;
          --primary-bg: #fafafa;
          --primary-text: #09090b;
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
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          -webkit-font-smoothing: antialiased;
        }

        .app-shell {
          height: 100%;
          overflow: auto;
          background: var(--bg);
          padding: 12px;
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

        .selection-name {
          font-size: 12px;
          font-weight: 600;
          color: var(--text);
          text-align: right;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 60%;
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
        }

        .empty {
          color: var(--text-muted);
          font-size: 12px;
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

        @media (max-width: 520px) {
          .preset-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }
      `}</style>

      <div className="panel">
        <div className="header-row">
          <div>
            <h1 className="title">DesignAgent</h1>
            <p className="sub">Contextual build prompts from Figma selection</p>
          </div>
        </div>

        <div className="preset-grid">
          {PRESET_ORDER.map((presetId) => {
            const definition = PRESET_DEFINITIONS[presetId];
            const active = presetId === preset;
            const PresetIconComponent = PRESET_ICON_COMPONENTS[definition.icon];
            return (
              <button
                key={definition.id}
                type="button"
                className={`preset-card ${active ? 'active' : ''}`}
                onClick={() => onSelectPreset(definition.id)}
                aria-pressed={active}
              >
                <div className="preset-icon">
                  <PresetIconComponent size={16} strokeWidth={1.9} />
                </div>
                <div className="preset-label">{definition.label}</div>
              </button>
            );
          })}
        </div>
      </div>

      {error ? <div className="error">{error}</div> : null}

      {analysis.hasSelection ? (
        <>
          <div className="panel">
            <div className="meta-row">
              <span className="badge">{toIntentLabel(analysis.intent)}</span>
              <div className="selection-name">{analysis.selectedNode.name}</div>
            </div>

            {analysis.platformWarnings.length > 0 ? (
              <div className="warn-box">
                <strong>Platform warning</strong>
                {analysis.platformWarnings.map((warning) => (
                  <div key={warning}>- {warning}</div>
                ))}
              </div>
            ) : null}

            {analysis.mode === 'system-first' && analysis.coverageWarnings.length > 0 ? (
              <div className="warn-box">
                <strong>System-first warning</strong>
                {analysis.coverageWarnings.map((warning) => (
                  <div key={warning}>- {warning}</div>
                ))}
              </div>
            ) : null}

            <div className="prompt-label">Build Prompt</div>
            <textarea readOnly value={analysis.prompt} />
            <div className="prompt-actions">
              <button type="button" className="btn-primary" onClick={onCopyPrompt}>
                Copy Prompt
              </button>
              {copyStatus ? <span className="status-pill">{copyStatus}</span> : null}
            </div>
          </div>

          {analysis.flowCapable ? (
            <div className="panel">
              <div className="pro-lock">
                <div>
                  <strong>Flow-capable selection detected</strong>
                  <div className="reason">Creates multi-screen prompts + navigation wiring.</div>
                </div>
                <button type="button" disabled title="Creates multi-screen prompts + navigation wiring.">
                  Generate Flow Prompt (Pro)
                </button>
              </div>
            </div>
          ) : null}

          <details className="panel">
            <summary>Advanced</summary>

            <div className="meta-row score-meta-row">
              <div className="prompt-label">AI-Ready Score</div>
              <span className="status-pill">{adjustedScoreTotal}/100</span>
            </div>

            <div className="score-track">
              <div className="score-fill" style={{ width: `${scorePercent}%` }} />
            </div>

            <table>
              <thead>
                <tr>
                  <th>Signal</th>
                  <th>Score</th>
                </tr>
              </thead>
              <tbody>
                {SCORE_CATEGORIES.map((category) => (
                  <tr key={category}>
                    <td>{plainCategoryLabel(category)}</td>
                    <td>
                      {(adjustedScoreBreakdown?.[category] ??
                        getCategoryScore(analysis.score, category))}
                      /{CATEGORY_MAX[category]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <details>
              <summary>Checklist</summary>
              {SCORE_CATEGORIES.map((category) => {
                const items = analysis.checklistByCategory[category] ?? [];
                if (items.length === 0) {
                  return (
                    <div key={category} className="check-item">
                      <div>
                        <strong>{plainCategoryLabel(category)}</strong> (0)
                      </div>
                      <div className="ok-msg">
                        <CheckCircle2 size={14} strokeWidth={2} />
                        <span>Looks good. No action needed.</span>
                      </div>
                    </div>
                  );
                }

                return (
                  <details key={category}>
                    <summary>
                      {plainCategoryLabel(category)} ({items.length})
                    </summary>
                    {items.map((item) => {
                      const fixInfo = issueFixState[issueKey(item)];
                      return (
                        <div key={`${item.nodeId}-${item.reason}`} className="check-item">
                          <div>
                            <strong>{item.nodeName}</strong> ({item.nodeId})
                          </div>
                          <div className="reason">{item.reason}</div>
                          {fixInfo ? (
                            <div className={`issue-badge ${fixInfo.status}`} title={fixInfo.detail}>
                              {fixInfo.status === 'fixed' ? 'Fixed' : 'Skipped'}
                            </div>
                          ) : null}
                          <div>{item.suggestion}</div>
                          <div className="check-actions">
                            <button type="button" onClick={() => onSkipIssue(item)}>
                              <span className="btn-with-icon">
                                <Undo2 size={13} strokeWidth={2} />
                                <span>Skip issue</span>
                              </span>
                            </button>
                            <button type="button" onClick={() => onFocusItem(item)}>
                              <span className="btn-with-icon">
                                <Eye size={13} strokeWidth={2} />
                                <span>Focus</span>
                              </span>
                            </button>
                            <button type="button" onClick={() => onAddAnnotation(item)}>
                              <span className="btn-with-icon">
                                <StickyNote size={13} strokeWidth={2} />
                                <span>Add annotation</span>
                              </span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </details>
                );
              })}
            </details>

            <details>
              <summary>Developer Debug (uiSpec JSON)</summary>
              <p className="hint-text">
                Use this only for debugging extraction output or integrating custom automations.
              </p>
              <pre className="json-view">{JSON.stringify(analysis.uiSpec, null, 2)}</pre>
            </details>
          </details>
        </>
      ) : (
        <div className="empty-state">
          <div className="empty-state-icon">
            <Frame size={56} strokeWidth={1.8} />
          </div>
          <p className="empty-state-text">{analysis.message}</p>
        </div>
      )}
    </div>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Missing root element');
}

createRoot(rootElement).render(<App />);
