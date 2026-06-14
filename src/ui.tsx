import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  type AnalysisResult,
  type ChecklistItem,
  type ExportedAsset,
  type Preset,
  type ScoreCategory,
  type ScoreResult
} from './core/types';
import type { ToUIMessage } from './shared/messages';
import {
  AdvancedPanel,
  BridgeBar,
  type BridgeStatus,
  EmptyState,
  Footer,
  HeaderPanel,
  LoadingPanel,
  PromptPanel
} from './ui_components';
import { UI_STYLES } from './ui_theme';

// Figma's manifest only allows a localhost origin (not a raw IP), and CSP
// requires the connection host to match — so connect via localhost too.
const BRIDGE_URL = 'ws://localhost:3790';

const INITIAL_ANALYSIS: AnalysisResult = {
  hasSelection: false,
  preset: 'swiftui-ios',
  mode: 'system-first',
  flowCapable: false,
  message: 'Select a frame, instance or section.'
};

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

const SCORE_CATEGORIES: ScoreCategory[] = [
  'Component Coverage',
  'Tokenization Coverage',
  'Layout Semantics',
  'Naming + Semantics',
  'Variant Completeness'
];

const FIGMA_DOCS = {
  instanceNode: 'https://www.figma.com/plugin-docs/api/InstanceNode/',
  textNode: 'https://www.figma.com/plugin-docs/api/TextNode/',
  sceneNode: 'https://www.figma.com/plugin-docs/api/SceneNode/',
  pluginApi: 'https://www.figma.com/plugin-docs/api/PluginAPI/',
  mixed: 'https://www.figma.com/plugin-docs/api/figma-mixed/'
} as const;

interface ErrorHelpRule {
  url: string;
  patterns: RegExp[];
}

const ERROR_HELP_RULES: ErrorHelpRule[] = [
  {
    url: FIGMA_DOCS.instanceNode,
    patterns: [/get_componentproperties/i, /componentproperties/i, /maincomponent/i]
  },
  {
    url: FIGMA_DOCS.mixed,
    patterns: [/figma\.mixed/i, /\bmixed\b/i]
  },
  {
    url: FIGMA_DOCS.textNode,
    patterns: [/loadfontasync/i, /font/i, /\btext\b/i, /characters/i]
  },
  {
    url: FIGMA_DOCS.sceneNode,
    patterns: [/getnodebyidasync/i, /node not found/i, /invalid node/i]
  },
  {
    url: FIGMA_DOCS.pluginApi,
    patterns: [
      /annotation/i,
      /plugindata/i,
      /relaunchdata/i,
      /layoutmode/i,
      /constraints/i,
      /readonly/i,
      /permission/i
    ]
  }
];

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

function pickPngAsset(assets: ExportedAsset[] | undefined): ExportedAsset | undefined {
  if (!assets || assets.length === 0) {
    return undefined;
  }
  return assets.find((asset) => asset.format === 'PNG') ?? assets[0];
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function dataUrlToBlobSync(dataUrl: string, fallbackMime = 'image/png'): Blob {
  const match = /^data:([^;]+);base64,([\s\S]+)$/.exec(dataUrl);
  if (!match) {
    throw new Error('Unrecognized data URL format');
  }
  const mime = match[1] || fallbackMime;
  const bytes = base64ToBytes(match[2] ?? '');
  return new Blob([bytes.buffer as ArrayBuffer], { type: mime });
}

const SUPPORTS_IMAGE_CLIPBOARD: boolean =
  typeof ClipboardItem !== 'undefined' &&
  typeof navigator !== 'undefined' &&
  !!navigator.clipboard &&
  typeof navigator.clipboard.write === 'function';

function sanitizeFilename(name: string): string {
  const trimmed = name.trim().replace(/[\s/\\]+/g, '-').replace(/[^\w.-]/g, '');
  return trimmed.length > 0 ? trimmed : 'designagent';
}

async function copyImageAsset(asset: ExportedAsset): Promise<{ ok: boolean; reason?: string }> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    return { ok: false, reason: 'Clipboard image write is unsupported here' };
  }
  try {
    const blob = dataUrlToBlobSync(asset.dataUrl);
    const item = new ClipboardItem({ [blob.type]: blob });
    await navigator.clipboard.write([item]);
    return { ok: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, reason };
  }
}

async function copyPromptAndImage(
  prompt: string,
  asset: ExportedAsset
): Promise<{ status: 'both' | 'text-only' | 'failed'; reason?: string }> {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      const imageBlob = dataUrlToBlobSync(asset.dataUrl);
      const textBlob = new Blob([prompt], { type: 'text/plain' });
      const item = new ClipboardItem({
        'text/plain': textBlob,
        [imageBlob.type]: imageBlob
      });
      await navigator.clipboard.write([item]);
      return { status: 'both' };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const ok = await copyText(prompt);
      return { status: ok ? 'text-only' : 'failed', reason };
    }
  }
  const ok = await copyText(prompt);
  return { status: ok ? 'text-only' : 'failed', reason: 'ClipboardItem unsupported' };
}

function downloadAsset(asset: ExportedAsset): boolean {
  try {
    const extension = asset.format === 'SVG' ? 'svg' : 'png';
    const filename = `${sanitizeFilename(asset.nodeName)}@${asset.scale}x.${extension}`;
    const anchor = document.createElement('a');
    anchor.href = asset.dataUrl;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    return true;
  } catch {
    return false;
  }
}

function downloadTextFile(filename: string, text: string, mime = 'text/markdown'): boolean {
  try {
    const blob = new Blob([text], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = sanitizeFilename(filename) || 'DESIGN.md';
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
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

function getErrorHelpLink(error: string): string | undefined {
  for (const rule of ERROR_HELP_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(error))) {
      return rule.url;
    }
  }
  return undefined;
}

function App(): JSX.Element {
  const [preset, setPreset] = useState<Preset>('swiftui-ios');
  const [activeTab, setActiveTab] = useState<'prompt' | 'score'>('prompt');
  const [analysis, setAnalysis] = useState<AnalysisResult>(INITIAL_ANALYSIS);
  const [selectionLinkInput, setSelectionLinkInput] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [copyStatus, setCopyStatus] = useState<string>('');
  const [issueFixState, setIssueFixState] = useState<
    Record<string, { status: 'fixed' | 'skipped'; detail: string }>
  >({});
  const [analyzing, setAnalyzing] = useState<
    { nodeId: string; nodeName: string; nodeType: string } | null
  >(null);
  const [bridgeEnabled, setBridgeEnabled] = useState<boolean>(false);
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>('off');
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const reconnectAttempt = useRef<number>(0);

  useEffect(() => {
    const listener = (event: MessageEvent<{ pluginMessage?: ToUIMessage }>) => {
      const message = event.data.pluginMessage;
      if (!message) {
        return;
      }

      if (message.type === 'ANALYSIS_STARTED') {
        setError('');
        setAnalyzing({
          nodeId: message.nodeId,
          nodeName: message.nodeName,
          nodeType: message.nodeType
        });
        return;
      }

      if (message.type === 'ANALYSIS_RESULT') {
        setError('');
        setAnalyzing(null);
        setAnalysis(message.payload);
        setPreset(message.payload.preset);
        setActiveTab('prompt');

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

      if (message.type === 'DESIGN_MD_RESULT') {
        setError('');
        const saved = downloadTextFile(message.filename, message.markdown);
        const frameLabel = message.frameCount === 1 ? 'frame' : 'frames';
        setCopyStatus(
          saved
            ? `DESIGN.md saved (${message.frameCount} ${frameLabel})`
            : 'DESIGN.md export failed'
        );
        setTimeout(() => setCopyStatus(''), 2600);
        return;
      }

      if (message.type === 'BRIDGE_RESULT') {
        const socket = socketRef.current;
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(
            JSON.stringify({
              type: 'response',
              id: message.id,
              ok: message.ok,
              result: message.result,
              error: message.error
            })
          );
        }
        return;
      }

      if (message.type === 'ERROR') {
        setError(message.message);
        setAnalyzing(null);
      }
    };

    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, []);

  // Claude Code bridge: the WebSocket lives here in the UI iframe (the plugin
  // sandbox has no WebSocket). It relays bridge requests to code.ts and sends
  // results back. Reconnects with backoff while enabled.
  useEffect(() => {
    if (!bridgeEnabled) {
      setBridgeStatus('off');
      return;
    }

    let cancelled = false;

    const clearReconnect = () => {
      if (reconnectTimer.current !== null) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
    };

    const scheduleReconnect = () => {
      if (cancelled) {
        return;
      }
      setBridgeStatus('connecting');
      const delay =
        Math.min(30000, 1000 * 2 ** reconnectAttempt.current) + Math.floor(Math.random() * 500);
      reconnectAttempt.current += 1;
      clearReconnect();
      reconnectTimer.current = window.setTimeout(connect, delay);
    };

    function connect(): void {
      if (cancelled) {
        return;
      }
      setBridgeStatus('connecting');
      let socket: WebSocket;
      try {
        socket = new WebSocket(BRIDGE_URL);
      } catch {
        scheduleReconnect();
        return;
      }
      socketRef.current = socket;

      socket.onopen = () => {
        if (cancelled) {
          socket.close();
          return;
        }
        reconnectAttempt.current = 0;
        setBridgeStatus('connected');
        try {
          socket.send(JSON.stringify({ type: 'hello', role: 'figma-plugin' }));
        } catch {
          // ignore
        }
      };

      socket.onmessage = (event: MessageEvent) => {
        if (typeof event.data !== 'string') {
          return;
        }
        let msg: { type?: string; id?: string; command?: string; params?: unknown };
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        if (!msg || typeof msg !== 'object') {
          return;
        }
        if (msg.type === 'ping') {
          try {
            socket.send(JSON.stringify({ type: 'pong' }));
          } catch {
            // ignore
          }
          return;
        }
        if (msg.type === 'request' && typeof msg.id === 'string' && typeof msg.command === 'string') {
          postPluginMessage({
            type: 'BRIDGE_COMMAND',
            id: msg.id,
            command: msg.command,
            params: msg.params && typeof msg.params === 'object' ? (msg.params as Record<string, unknown>) : {}
          });
        }
      };

      socket.onerror = () => {
        setBridgeStatus('error');
      };

      socket.onclose = () => {
        if (socketRef.current === socket) {
          socketRef.current = null;
        }
        if (cancelled) {
          return;
        }
        scheduleReconnect();
      };
    }

    reconnectAttempt.current = 0;
    connect();

    return () => {
      cancelled = true;
      clearReconnect();
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        try {
          socket.close();
        } catch {
          // ignore
        }
      }
    };
  }, [bridgeEnabled]);

  const skippedIssueKeys = useMemo(
    () =>
      new Set(
        Object.entries(issueFixState)
          .filter(([, value]) => value.status === 'skipped')
          .map(([key]) => key)
      ),
    [issueFixState]
  );

  const scoreTotal = analysis.hasSelection ? analysis.score.total : 0;
  const scoreMax = analysis.hasSelection ? analysis.score.applicableMax : 0;

  const scorePercent = useMemo(() => {
    if (!analysis.hasSelection || scoreMax <= 0) {
      return 0;
    }
    return Math.max(0, Math.min(100, Math.round((scoreTotal / scoreMax) * 100)));
  }, [analysis, scoreTotal, scoreMax]);

  const dismissedCount = useMemo(() => {
    if (!analysis.hasSelection) {
      return 0;
    }
    const activeKeys = new Set(
      analysis.checklist.map((item) => issueKey(item))
    );
    return Array.from(skippedIssueKeys).filter((key) => activeKeys.has(key)).length;
  }, [analysis, skippedIssueKeys]);

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

  const pngAsset =
    analysis.hasSelection ? pickPngAsset(analysis.assets) : undefined;
  const imageSizeKb = pngAsset
    ? Math.round(pngAsset.byteLength / 102.4) / 10
    : undefined;

  const onCopyImage = async () => {
    if (!pngAsset) {
      return;
    }
    const result = await copyImageAsset(pngAsset);
    if (result.ok) {
      setCopyStatus('Image copied');
    } else {
      setCopyStatus(`Copy image failed: ${result.reason ?? 'unknown'} — use Save PNG`);
    }
    setTimeout(() => setCopyStatus(''), 3000);
  };

  const onSavePng = () => {
    if (!pngAsset) {
      return;
    }
    const ok = downloadAsset(pngAsset);
    setCopyStatus(ok ? 'PNG saved' : 'Save failed');
    setTimeout(() => setCopyStatus(''), 1600);
  };

  const onCopyPromptAndImage = async () => {
    if (!analysis.hasSelection) {
      return;
    }
    if (!pngAsset) {
      const copied = await copyText(analysis.prompt);
      setCopyStatus(copied ? 'Copied (no image yet)' : 'Copy failed');
      setTimeout(() => setCopyStatus(''), 1600);
      return;
    }
    const result = await copyPromptAndImage(analysis.prompt, pngAsset);
    if (result.status === 'both') {
      setCopyStatus('Prompt + image copied');
    } else if (result.status === 'text-only') {
      setCopyStatus(
        `Prompt copied — image blocked${result.reason ? ` (${result.reason})` : ''} — use Save PNG`
      );
    } else {
      setCopyStatus(`Copy failed: ${result.reason ?? 'unknown'}`);
    }
    setTimeout(() => setCopyStatus(''), 3000);
  };

  const onExportDesignMd = () => {
    if (!analysis.hasSelection) {
      return;
    }
    setCopyStatus('Generating DESIGN.md…');
    postPluginMessage({ type: 'EXPORT_DESIGN_MD' });
  };

  const onApplySelectionLink = () => {
    postPluginMessage({
      type: 'SET_FIGMA_LINK_BASE',
      link: selectionLinkInput
    });
    setCopyStatus('Link applied');
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
    setCopyStatus('Dismissed');
    setTimeout(() => setCopyStatus(''), 1600);
  };

  const errorHelpLink = error ? getErrorHelpLink(error) : undefined;
  const hasAppliedLink = Boolean(analysis.hasSelection && analysis.selectedNode.link);

  return (
    <div className="app-shell">
      <style>{UI_STYLES}</style>
      <div className="app-body">
        <HeaderPanel preset={preset} onSelectPreset={onSelectPreset} />

        <BridgeBar
          status={bridgeStatus}
          enabled={bridgeEnabled}
          onToggle={() => setBridgeEnabled((value) => !value)}
        />

        {error ? (
          <div className="error">
            <span>{error}</span>
            {errorHelpLink ? (
              <a href={errorHelpLink} target="_blank" rel="noreferrer">
                What's this?
              </a>
            ) : null}
          </div>
        ) : null}

        {analyzing ? (
          <LoadingPanel
            nodeName={analyzing.nodeName}
            nodeType={analyzing.nodeType}
          />
        ) : analysis.hasSelection ? (
          hasAppliedLink ? (
            <>
              <div className="tab-nav" role="tablist" aria-label="Prompt and score tabs">
                <button
                  type="button"
                  role="tab"
                  id="tab-prompt"
                  aria-controls="panel-prompt"
                  aria-selected={activeTab === 'prompt'}
                  className={`tab-btn ${activeTab === 'prompt' ? 'active' : ''}`}
                  onClick={() => setActiveTab('prompt')}
                >
                  Prompt
                </button>
                <button
                  type="button"
                  role="tab"
                  id="tab-score"
                  aria-controls="panel-score"
                  aria-selected={activeTab === 'score'}
                  className={`tab-btn ${activeTab === 'score' ? 'active' : ''}`}
                  onClick={() => setActiveTab('score')}
                >
                  Score {scoreTotal}/{scoreMax || 100}
                </button>
              </div>

              <div
                role="tabpanel"
                id="panel-prompt"
                aria-labelledby="tab-prompt"
                hidden={activeTab !== 'prompt'}
              >
                <PromptPanel
                  mode={analysis.mode}
                  intentLabel={toIntentLabel(analysis.intent)}
                  selectedNodeName={analysis.selectedNode.name}
                  selectionLink={analysis.selectedNode.link}
                  selectionLinkInput={selectionLinkInput}
                  onSelectionLinkInputChange={setSelectionLinkInput}
                  onApplySelectionLink={onApplySelectionLink}
                  prompt={analysis.prompt}
                  onCopyPrompt={onCopyPrompt}
                  copyStatus={copyStatus}
                  platformWarnings={analysis.platformWarnings}
                  coverageWarnings={analysis.coverageWarnings}
                  hasImageAsset={Boolean(pngAsset)}
                  imageSizeKb={imageSizeKb}
                  canCopyImageToClipboard={SUPPORTS_IMAGE_CLIPBOARD}
                  onCopyImage={onCopyImage}
                  onSavePng={onSavePng}
                  onCopyPromptAndImage={onCopyPromptAndImage}
                  onExportDesignMd={onExportDesignMd}
                />
              </div>

              <div
                role="tabpanel"
                id="panel-score"
                aria-labelledby="tab-score"
                hidden={activeTab !== 'score'}
              >
                <AdvancedPanel
                  scoreTotal={scoreTotal}
                  scoreMax={scoreMax}
                  scorePercent={scorePercent}
                  dismissedCount={dismissedCount}
                  score={analysis.score}
                  plainCategoryLabel={plainCategoryLabel}
                  getCategoryScore={getCategoryScore}
                  checklistByCategory={analysis.checklistByCategory}
                  issueFixState={issueFixState}
                  issueKey={issueKey}
                  onSkipIssue={onSkipIssue}
                  onFocusItem={onFocusItem}
                  onAddAnnotation={onAddAnnotation}
                  uiSpec={analysis.uiSpec}
                />
              </div>
            </>
          ) : (
            <PromptPanel
              mode={analysis.mode}
              intentLabel={toIntentLabel(analysis.intent)}
              selectedNodeName={analysis.selectedNode.name}
              selectionLink={analysis.selectedNode.link}
              selectionLinkInput={selectionLinkInput}
              onSelectionLinkInputChange={setSelectionLinkInput}
              onApplySelectionLink={onApplySelectionLink}
              prompt={analysis.prompt}
              onCopyPrompt={onCopyPrompt}
              copyStatus={copyStatus}
              platformWarnings={analysis.platformWarnings}
              coverageWarnings={analysis.coverageWarnings}
              hasImageAsset={Boolean(pngAsset)}
              imageSizeKb={imageSizeKb}
              canCopyImageToClipboard={SUPPORTS_IMAGE_CLIPBOARD}
              onCopyImage={onCopyImage}
              onSavePng={onSavePng}
              onCopyPromptAndImage={onCopyPromptAndImage}
              onExportDesignMd={onExportDesignMd}
            />
          )
        ) : (
          <EmptyState message={analysis.message} />
        )}
      </div>

      <Footer />
    </div>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Missing root element');
}

createRoot(rootElement).render(<App />);
