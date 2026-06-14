import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { type AnalysisResult, type ExportedAsset, type Preset } from './core/types';
import type { ToUIMessage } from './shared/messages';
import {
  AppHeader,
  BridgeBar,
  type BridgeStatus,
  CapabilityView,
  EmptyState,
  ExportPanel,
  Footer,
  LoadingPanel,
  type MainTab,
  MainTabs,
  PresetSelector
} from './ui_components';
import { UI_STYLES } from './ui_theme';

const BRIDGE_URL = 'ws://localhost:3790';

const INITIAL_ANALYSIS: AnalysisResult = {
  hasSelection: false,
  preset: 'swiftui-ios',
  mode: 'system-first',
  flowCapable: false,
  message: 'Select a frame, instance or section.'
};

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
  { url: FIGMA_DOCS.mixed, patterns: [/figma\.mixed/i, /\bmixed\b/i] },
  { url: FIGMA_DOCS.textNode, patterns: [/loadfontasync/i, /font/i, /\btext\b/i, /characters/i] },
  { url: FIGMA_DOCS.sceneNode, patterns: [/getnodebyidasync/i, /node not found/i, /invalid node/i] },
  {
    url: FIGMA_DOCS.pluginApi,
    patterns: [/annotation/i, /plugindata/i, /relaunchdata/i, /layoutmode/i, /constraints/i, /readonly/i, /permission/i]
  }
];

function postPluginMessage(message: unknown): void {
  parent.postMessage({ pluginMessage: message }, '*');
}

function pickPngAsset(assets: ExportedAsset[] | undefined): ExportedAsset | undefined {
  if (!assets || assets.length === 0) {
    return undefined;
  }
  return assets.find((asset) => asset.format === 'PNG') ?? assets[0];
}

function sanitizeFilename(name: string): string {
  const trimmed = name.trim().replace(/[\s/\\]+/g, '-').replace(/[^\w.-]/g, '');
  return trimmed.length > 0 ? trimmed : 'designagent';
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
    anchor.download = sanitizeFilename(filename) || 'export.txt';
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
  if (intent === 'screen') return 'Screen';
  if (intent === 'component') return 'Component';
  return 'Section';
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
  const [mainTab, setMainTab] = useState<MainTab>('design-to-code');
  const [analysis, setAnalysis] = useState<AnalysisResult>(INITIAL_ANALYSIS);
  const [error, setError] = useState<string>('');
  const [status, setStatus] = useState<string>('');
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
        return;
      }

      if (message.type === 'DESIGN_MD_RESULT') {
        setError('');
        const saved = downloadTextFile(message.filename, message.markdown, 'text/markdown');
        const label = message.frameCount === 1 ? 'frame' : 'frames';
        setStatus(saved ? `DESIGN.md saved (${message.frameCount} ${label})` : 'Export failed');
        setTimeout(() => setStatus(''), 2600);
        return;
      }

      if (message.type === 'HTML_RESULT') {
        setError('');
        const saved = downloadTextFile(message.filename, message.html, 'text/html');
        setStatus(saved ? 'HTML saved' : 'Export failed');
        setTimeout(() => setStatus(''), 2600);
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

  // Claude Code bridge: the WebSocket lives here in the UI iframe (the sandbox has
  // none). It relays bridge requests to code.ts and sends results back, reconnecting
  // with backoff while enabled.
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

      socket.onmessage = (messageEvent: MessageEvent) => {
        if (typeof messageEvent.data !== 'string') {
          return;
        }
        let msg: { type?: string; id?: string; command?: string; params?: unknown };
        try {
          msg = JSON.parse(messageEvent.data);
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
            params:
              msg.params && typeof msg.params === 'object' ? (msg.params as Record<string, unknown>) : {}
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

  const pngAsset = analysis.hasSelection ? pickPngAsset(analysis.assets) : undefined;
  const imageSizeKb = useMemo(
    () => (pngAsset ? Math.round(pngAsset.byteLength / 102.4) / 10 : undefined),
    [pngAsset]
  );

  const onSelectPreset = (nextPreset: Preset) => {
    setPreset(nextPreset);
    postPluginMessage({ type: 'SET_PRESET', preset: nextPreset });
  };

  const onExportDesignMd = () => {
    if (!analysis.hasSelection) {
      return;
    }
    setStatus('Generating DESIGN.md…');
    postPluginMessage({ type: 'EXPORT_DESIGN_MD' });
  };

  const onExportHtml = () => {
    if (!analysis.hasSelection) {
      return;
    }
    setStatus('Generating HTML…');
    postPluginMessage({ type: 'EXPORT_HTML' });
  };

  const onSavePng = () => {
    if (!pngAsset) {
      return;
    }
    const ok = downloadAsset(pngAsset);
    setStatus(ok ? 'PNG saved' : 'Save failed');
    setTimeout(() => setStatus(''), 1600);
  };

  const errorHelpLink = error ? getErrorHelpLink(error) : undefined;

  return (
    <div className="app-shell">
      <style>{UI_STYLES}</style>
      <div className="app-body">
        <AppHeader version="v1.4.0" />

        <BridgeBar
          status={bridgeStatus}
          enabled={bridgeEnabled}
          onToggle={() => setBridgeEnabled((value) => !value)}
        />

        <MainTabs active={mainTab} onChange={setMainTab} />

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

        {mainTab === 'design-to-code' ? (
          <>
            <PresetSelector preset={preset} onSelectPreset={onSelectPreset} />

            {analyzing ? (
              <LoadingPanel nodeName={analyzing.nodeName} nodeType={analyzing.nodeType} />
            ) : analysis.hasSelection ? (
              <ExportPanel
                intentLabel={toIntentLabel(analysis.intent)}
                selectedNodeName={analysis.selectedNode.name}
                status={status}
                hasImageAsset={Boolean(pngAsset)}
                imageSizeKb={imageSizeKb}
                onExportDesignMd={onExportDesignMd}
                onExportHtml={onExportHtml}
                onSavePng={onSavePng}
              />
            ) : (
              <EmptyState message={analysis.message} />
            )}
          </>
        ) : (
          <CapabilityView />
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
