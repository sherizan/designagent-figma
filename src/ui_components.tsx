import React from 'react';
import {
  Apple,
  Bot,
  CheckCircle2,
  Command,
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
  type ChecklistItem,
  type Mode,
  type Preset,
  type PresetIcon,
  type ScoreCategory,
  type ScoreResult,
  type UiSpec
} from './core/types';

const PRESET_ORDER: Preset[] = [
  'swiftui-ios',
  'jetpack-compose-android',
  'react-native-expo-nativewind',
  'nextjs-tailwind-shadcn',
  'web-html-css'
];

const PRESET_ICON_COMPONENTS: Record<PresetIcon, LucideIcon> = {
  globe: Globe,
  smartphone: Smartphone,
  'file-code': FileCode,
  apple: Apple,
  bot: Bot
};

const CATEGORY_MAX: Record<ScoreCategory, number> = {
  'Component Coverage': 30,
  'Tokenization Coverage': 25,
  'Layout Semantics': 20,
  'Naming + Semantics': 15,
  'Variant Completeness': 10
};

interface HeaderPanelProps {
  preset: Preset;
  onSelectPreset: (preset: Preset) => void;
}

export function HeaderPanel({ preset, onSelectPreset }: HeaderPanelProps): JSX.Element {
  return (
    <div className="panel header-panel">
      <div className="header-row">
        <div className="header-copy">
          <h1 className="title">DesignAgent</h1>
          <p className="sub">Build what you design. No drift.</p>
        </div>
        <div className="version-tag">v1.2</div>
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
                <PresetIconComponent size={16} strokeWidth={1.75} />
              </div>
              <div className="preset-label">{definition.label}</div>
            </button>
          );
        })}
      </div>
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

interface PromptPanelProps {
  mode: Mode;
  intentLabel: string;
  selectedNodeName: string;
  selectionLink?: string;
  selectionLinkInput: string;
  onSelectionLinkInputChange: (value: string) => void;
  onApplySelectionLink: () => void;
  prompt: string;
  onCopyPrompt: () => void;
  copyStatus: string;
  platformWarnings: string[];
  coverageWarnings: string[];
  hasImageAsset: boolean;
  imageSizeKb?: number;
  canCopyImageToClipboard: boolean;
  onCopyImage: () => void;
  onSavePng: () => void;
  onCopyPromptAndImage: () => void;
}

export function PromptPanel(props: PromptPanelProps): JSX.Element {
  const {
    mode,
    intentLabel,
    selectedNodeName,
    selectionLink,
    selectionLinkInput,
    onSelectionLinkInputChange,
    onApplySelectionLink,
    prompt,
    onCopyPrompt,
    copyStatus,
    platformWarnings,
    coverageWarnings,
    hasImageAsset,
    imageSizeKb,
    canCopyImageToClipboard,
    onCopyImage,
    onSavePng,
    onCopyPromptAndImage
  } = props;

  return (
    <div className="panel">
      <div className="meta-row">
        <div className="selection-group">
          <span className="badge">{intentLabel}</span>
          <div className="selection-name-inline">{selectedNodeName}</div>
        </div>
      </div>

      {platformWarnings.length > 0 ? (
        <div className="warn-box">
          <strong>Platform warning</strong>
          {platformWarnings.map((warning) => (
            <div key={warning}>- {warning}</div>
          ))}
        </div>
      ) : null}

      {mode === 'system-first' && coverageWarnings.length > 0 ? (
        <div className="warn-box">
          <strong>System-first warning</strong>
          {coverageWarnings.map((warning) => (
            <div key={warning}>- {warning}</div>
          ))}
        </div>
      ) : null}

      {!selectionLink ? (
        <div className="link-required">
          <p className="link-required-hint">
            Paste your Figma link.
            <span className="shortcut-inline">
              <Command size={12} strokeWidth={2} />
              <span>L to copy</span>
            </span>
          </p>
          <div className="link-required-row">
            <input
              type="text"
              value={selectionLinkInput}
              onChange={(event) => onSelectionLinkInputChange(event.target.value)}
              placeholder="https://www.figma.com/design/AbCdEf123456/App?node-id=17073-40576&t=abc123-1"
              aria-label="Figma selection link"
            />
            <button type="button" className="btn-primary" onClick={onApplySelectionLink}>
              Use link
            </button>
          </div>
        </div>
      ) : (
        <>
          <textarea readOnly value={prompt} />
          <div className="prompt-actions">
            {copyStatus ? <span className="status-pill">{copyStatus}</span> : null}
            {hasImageAsset ? (
              <button
                type="button"
                className="btn"
                onClick={onSavePng}
                title={
                  imageSizeKb
                    ? `Save exported PNG (${imageSizeKb} KB) to disk`
                    : 'Save exported PNG to disk'
                }
              >
                Save PNG
              </button>
            ) : null}
            {hasImageAsset && canCopyImageToClipboard ? (
              <button
                type="button"
                className="btn"
                onClick={onCopyImage}
                title={
                  imageSizeKb
                    ? `Copy exported PNG (${imageSizeKb} KB) to clipboard`
                    : 'Copy exported PNG to clipboard'
                }
              >
                Copy image
              </button>
            ) : null}
            {hasImageAsset && canCopyImageToClipboard ? (
              <button
                type="button"
                className="btn-primary"
                onClick={onCopyPromptAndImage}
                title={
                  imageSizeKb
                    ? `Copy prompt and ${imageSizeKb} KB image to clipboard`
                    : 'Copy prompt and image to clipboard'
                }
              >
                Copy Prompt + Image
              </button>
            ) : (
              <button type="button" className="btn-primary" onClick={onCopyPrompt}>
                Copy Prompt
              </button>
            )}
          </div>
          {hasImageAsset ? (
            <p className="prompt-hint">
              {canCopyImageToClipboard ? (
                <>
                  Tip: paste once into Claude (multimodal). If the image doesn't attach, use
                  <strong> Save PNG</strong> and drag the file in.
                </>
              ) : (
                <>
                  This host can't write images to the clipboard. Use
                  <strong> Save PNG</strong> and drop the file into Claude.
                </>
              )}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

interface AdvancedPanelProps {
  adjustedScoreTotal: number;
  scorePercent: number;
  score: ScoreResult;
  adjustedScoreBreakdown: Record<ScoreCategory, number> | null;
  plainCategoryLabel: (category: ScoreCategory) => string;
  getCategoryScore: (score: ScoreResult, category: ScoreCategory) => number;
  checklistByCategory: Record<ScoreCategory, ChecklistItem[]>;
  issueFixState: Record<string, { status: 'fixed' | 'skipped'; detail: string }>;
  issueKey: (item: { category: string; nodeId: string; reason: string }) => string;
  onSkipIssue: (item: ChecklistItem) => void;
  onFocusItem: (item: ChecklistItem) => void;
  onAddAnnotation: (item: ChecklistItem) => void;
  uiSpec: UiSpec;
}

export function AdvancedPanel(props: AdvancedPanelProps): JSX.Element {
  const {
    adjustedScoreTotal,
    scorePercent,
    score,
    adjustedScoreBreakdown,
    plainCategoryLabel,
    getCategoryScore,
    checklistByCategory,
    issueFixState,
    issueKey,
    onSkipIssue,
    onFocusItem,
    onAddAnnotation
  } = props;

  return (
    <div className="panel">
      <div className="meta-row score-meta-row">
        <div className="section-subtitle">AI-Ready Score</div>
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
                {(adjustedScoreBreakdown?.[category] ?? getCategoryScore(score, category))}/
                {CATEGORY_MAX[category]}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="section-title">Checklist</div>
      {SCORE_CATEGORIES.map((category) => {
        const items = checklistByCategory[category] ?? [];
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
          <div key={category}>
            <div className="section-subtitle">
              {plainCategoryLabel(category)} ({items.length})
            </div>
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
          </div>
        );
      })}
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
