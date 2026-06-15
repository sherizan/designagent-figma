import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { type AnalysisResult } from './core/types';
import type { ToUIMessage } from './shared/messages';
import {
  BridgeBar,
  type BridgeStatus,
  CapabilityView,
  EmptyState,
  ExportPanel,
  Footer,
  type HtmlFileEntry,
  HtmlBrowser,
  LoadingPanel,
  type MainTab,
  MainTabs
} from './ui_components';
import type { DesignTreeNode } from './shared/designtree';
import { UI_STYLES } from './ui_theme';
import { renderHtmlToTree } from './ui_html';

const BRIDGE_URL = 'ws://localhost:3790';

const INITIAL_ANALYSIS: AnalysisResult = {
  hasSelection: false,
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

function sanitizeFilename(name: string): string {
  const trimmed = name.trim().replace(/[\s/\\]+/g, '-').replace(/[^\w.-]/g, '');
  return trimmed.length > 0 ? trimmed : 'designagent';
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
  const [mainTab, setMainTab] = useState<MainTab>('code-to-design');
  const [analysis, setAnalysis] = useState<AnalysisResult>(INITIAL_ANALYSIS);
  const [error, setError] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [analyzing, setAnalyzing] = useState<
    { nodeId: string; nodeName: string; nodeType: string } | null
  >(null);
  const [bridgeEnabled, setBridgeEnabled] = useState<boolean>(false);
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>('off');
  const [designMd, setDesignMd] = useState<{
    checked: boolean;
    exists: boolean;
    root: string;
  }>({ checked: false, exists: false, root: '' });
  // Whether the next DESIGN_MD_RESULT should download or write to the project.
  const designMdIntent = useRef<'download' | 'sync'>('download');
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const reconnectAttempt = useRef<number>(0);
  type Resolver = (msg: { ok: boolean; result?: unknown; error?: string }) => void;
  const serverPending = useRef<Map<string, Resolver>>(new Map());
  const localRenders = useRef<Map<string, Resolver>>(new Map());

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
        return;
      }

      if (message.type === 'DESIGN_MD_RESULT') {
        setError('');
        if (designMdIntent.current === 'sync') {
          // Write the generated spec into the project folder via the bridge.
          designMdIntent.current = 'download';
          callServer('write_design_md', { content: message.markdown })
            .then((res) => {
              const r = res as { path?: string };
              setStatus(`Synced to ${r?.path ?? 'DESIGN.md'}`);
              void checkDesignMd();
            })
            .catch((e) => setStatus(e instanceof Error ? e.message : 'Sync failed'))
            .finally(() => setTimeout(() => setStatus(''), 2600));
          return;
        }
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

      if (message.type === 'DESIGN_TREE_RESULT') {
        // Local (UI-initiated) renders resolve a pending promise; bridge renders
        // forward their result over the WS.
        const local = localRenders.current.get(message.id);
        if (local) {
          localRenders.current.delete(message.id);
          local({ ok: message.ok, result: message.result, error: message.error });
          return;
        }
      }

      if (message.type === 'BRIDGE_RESULT' || message.type === 'DESIGN_TREE_RESULT') {
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
        if (msg.type === 'server_response' && typeof msg.id === 'string') {
          const resolver = serverPending.current.get(msg.id);
          if (resolver) {
            serverPending.current.delete(msg.id);
            resolver(msg as { ok: boolean; result?: unknown; error?: string });
          }
          return;
        }
        if (msg.type === 'request' && typeof msg.id === 'string' && typeof msg.command === 'string') {
          const params =
            msg.params && typeof msg.params === 'object' ? (msg.params as Record<string, unknown>) : {};
          // html_to_design is handled in the UI iframe (it renders the HTML), then
          // handed to the sandbox to build nodes — not a normal sandbox command.
          if (msg.command === 'html_to_design') {
            try {
              const tree = renderHtmlToTree(
                String(params.html ?? ''),
                typeof params.width === 'number' ? params.width : 1280
              );
              postPluginMessage({
                type: 'CREATE_DESIGN_TREE',
                id: msg.id,
                tree,
                x: typeof params.x === 'number' ? params.x : undefined,
                y: typeof params.y === 'number' ? params.y : undefined,
                parentId: typeof params.parentId === 'string' ? params.parentId : undefined
              });
            } catch (renderError) {
              try {
                socket.send(
                  JSON.stringify({
                    type: 'response',
                    id: msg.id,
                    ok: false,
                    error: renderError instanceof Error ? renderError.message : String(renderError)
                  })
                );
              } catch {
                // ignore
              }
            }
            return;
          }
          postPluginMessage({ type: 'BRIDGE_COMMAND', id: msg.id, command: msg.command, params });
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

  function newId(prefix = ''): string {
    const uuid =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
    return prefix + uuid;
  }

  // Ask the MCP server (over the WS) for something only it can do (filesystem).
  const callServer = (command: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    return new Promise((resolve, reject) => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        reject(new Error('Claude bridge is not connected.'));
        return;
      }
      const id = newId();
      const timer = window.setTimeout(() => {
        serverPending.current.delete(id);
        reject(new Error('The bridge server did not respond.'));
      }, 20000);
      serverPending.current.set(id, (msg) => {
        window.clearTimeout(timer);
        if (msg.ok) {
          resolve(msg.result);
        } else {
          reject(new Error(msg.error || 'Bridge server error.'));
        }
      });
      socket.send(JSON.stringify({ type: 'server_request', id, command, params }));
    });
  };

  // Render a tree in the sandbox and await the result (UI-initiated, not a bridge call).
  const renderTreeLocally = (
    tree: DesignTreeNode
  ): Promise<{ ok: boolean; result?: unknown; error?: string }> => {
    return new Promise((resolve) => {
      const id = newId('local:');
      const timer = window.setTimeout(() => {
        localRenders.current.delete(id);
        resolve({ ok: false, error: 'Render timed out.' });
      }, 30000);
      localRenders.current.set(id, (msg) => {
        window.clearTimeout(timer);
        resolve(msg);
      });
      postPluginMessage({ type: 'CREATE_DESIGN_TREE', id, tree });
    });
  };

  const listHtmlFiles = async (): Promise<{ root: string; files: HtmlFileEntry[] }> => {
    const result = (await callServer('list_html_files')) as {
      root?: string;
      files?: HtmlFileEntry[];
    };
    return {
      root: typeof result?.root === 'string' ? result.root : '',
      files: result && Array.isArray(result.files) ? result.files : []
    };
  };

  const renderHtmlFile = async (path: string) => {
    const result = (await callServer('read_html_file', { path })) as { html?: string };
    const tree = renderHtmlToTree(String(result?.html ?? ''));
    return renderTreeLocally(tree);
  };

  // Ask the server whether DESIGN.md already lives in the project folder.
  async function checkDesignMd(): Promise<void> {
    try {
      const r = (await callServer('check_design_md')) as {
        exists?: boolean;
        root?: string;
      };
      setDesignMd({
        checked: true,
        exists: Boolean(r?.exists),
        root: typeof r?.root === 'string' ? r.root : ''
      });
    } catch {
      setDesignMd({ checked: false, exists: false, root: '' });
    }
  }

  // Re-check whenever the bridge connects; clear when it drops.
  useEffect(() => {
    if (bridgeStatus === 'connected') {
      void checkDesignMd();
    } else {
      setDesignMd({ checked: false, exists: false, root: '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridgeStatus]);

  const onExportDesignMd = () => {
    if (!analysis.hasSelection) {
      return;
    }
    designMdIntent.current = 'download';
    setStatus('Generating DESIGN.md…');
    postPluginMessage({ type: 'EXPORT_DESIGN_MD' });
  };

  // Generate from the current selection and write it into the project folder.
  const syncDesignMd = () => {
    if (!analysis.hasSelection) {
      return;
    }
    designMdIntent.current = 'sync';
    setStatus(designMd.exists ? 'Updating DESIGN.md…' : 'Creating DESIGN.md…');
    postPluginMessage({ type: 'EXPORT_DESIGN_MD' });
  };

  const onExportHtml = () => {
    if (!analysis.hasSelection) {
      return;
    }
    setStatus('Generating HTML…');
    postPluginMessage({ type: 'EXPORT_HTML' });
  };

  const errorHelpLink = error ? getErrorHelpLink(error) : undefined;

  return (
    <div className="app-shell">
      <style>{UI_STYLES}</style>
      <div className="app-body">
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
          analyzing ? (
            <LoadingPanel nodeName={analyzing.nodeName} nodeType={analyzing.nodeType} />
          ) : analysis.hasSelection ? (
            <ExportPanel
              intentLabel={toIntentLabel(analysis.intent)}
              selectedNodeName={analysis.selectedNode.name}
              status={status}
              bridgeConnected={bridgeStatus === 'connected'}
              designChecked={designMd.checked}
              designExists={designMd.exists}
              designRoot={designMd.root}
              onSyncDesignMd={syncDesignMd}
              onExportDesignMd={onExportDesignMd}
              onExportHtml={onExportHtml}
            />
          ) : (
            <EmptyState message={analysis.message} />
          )
        ) : (
          <>
            <CapabilityView />
            <HtmlBrowser
              connected={bridgeStatus === 'connected'}
              listFiles={listHtmlFiles}
              renderFile={renderHtmlFile}
            />
          </>
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
