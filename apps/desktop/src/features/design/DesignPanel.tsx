import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useWorkspaceTool } from '../../components/workspace/WorkspaceToolContext';
import { useWorkspaceVisible } from '../../components/workspace/WorkspaceContext';
import { useComposerStore } from '../../stores/composerStore';
import { useIsMounted } from '../../hooks/useIsMounted';
import { getDesignAsset, listDesignFiles } from './api';
import { DesignToolbar } from './components/DesignToolbar';
import { SelectionEditor } from './components/SelectionEditor';
import { VersionHistory } from './components/VersionHistory';
import { buildDesignPreview } from './preview';
import { useDesignDocument } from './useDesignDocument';
import type { DesignEditOperation, DesignSelection } from './types';

const POLL_MS = 2000;
const EMPTY_HTML = '<!doctype html><html><body></body></html>';
const isValidSelection = (value: unknown): value is DesignSelection => {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<DesignSelection>;
  return (
    Array.isArray(v.elementPath) &&
    v.elementPath.length <= 64 &&
    v.elementPath.every(i => Number.isInteger(i) && i >= 0 && i < 10000) &&
    typeof v.tagName === 'string' &&
    v.tagName.length <= 64 &&
    typeof v.text === 'string' &&
    v.text.length <= 20000 &&
    (v.sourceText === undefined ||
      (typeof v.sourceText === 'string' && v.sourceText.length <= 20000)) &&
    (v.color === undefined || typeof v.color === 'string') &&
    (v.backgroundColor === undefined || typeof v.backgroundColor === 'string') &&
    (v.base === undefined || typeof v.base === 'string')
  );
};

interface VerifyExpectation {
  elementPath: number[];
  expected: { color?: string; backgroundColor?: string };
}

/** Compare two CSS color notations via the browser's own serializer. */
function colorsEquivalent(written: string, computed: string): boolean {
  const a = written.trim();
  const b = computed.trim();
  if (a.toLowerCase() === b.toLowerCase()) return true;
  const probe = document.createElement('span');
  probe.style.color = a;
  const normalized = probe.style.color;
  return !!normalized && normalized.replace(/\s+/g, '').toLowerCase() === b.replace(/\s+/g, '').toLowerCase();
}

export function DesignPanel() {
  const tool = useWorkspaceTool();
  if (!tool?.sessionId || !tool.backendId)
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        请连接当前会话后端，再打开设计面板。
      </div>
    );
  const key = [
    tool.sessionId,
    tool.projectId ?? '',
    tool.workingDirectory ?? '',
    tool.backendId ?? 'local',
  ].join('\0');
  return (
    <DesignPanelSession
      key={key}
      sessionId={tool.sessionId}
      projectId={tool.projectId}
      workingDirectory={tool.workingDirectory}
      backendId={tool.backendId}
    />
  );
}

function DesignPanelSession({
  sessionId,
  projectId,
  workingDirectory,
  backendId,
}: {
  sessionId: string;
  projectId?: string;
  workingDirectory?: string;
  backendId: string;
}) {
  const visible = useWorkspaceVisible();
  const design = useDesignDocument({ backendId, sessionId });
  const {
    load,
    reload,
    pollRefresh,
    handleSelectionMessage,
    apply,
    undo,
    redo,
    save,
    setError,
    setOverrideWarning,
  } = design;
  const [files, setFiles] = useState<string[]>([]);
  const [preview, setPreview] = useState('');
  const [generatedFile, setGeneratedFile] = useState<string | null>(null);
  const [prefillNotice, setPrefillNotice] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [channel] = useState(
    () => `design-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
  );
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const filesRequestRef = useRef(0);
  const filesScanInFlightRef = useRef(false);
  const previewRequestRef = useRef(0);
  const previousFilesRef = useRef<string[] | null>(null);
  const waitingForGeneratedRef = useRef(false);
  const docPathRef = useRef<string | null>(null);
  const verifyRef = useRef<VerifyExpectation | null>(null);
  const isMounted = useIsMounted();

  useEffect(() => {
    docPathRef.current = design.doc?.path ?? null;
  }, [design.doc]);
  useEffect(() => {
    return () => {
      ++filesRequestRef.current;
      ++previewRequestRef.current;
    };
  }, []);

  const refresh = useCallback(
    async (quiet = false) => {
      if (filesScanInFlightRef.current) return;
      filesScanInFlightRef.current = true;
      const wasEmpty = previousFilesRef.current?.length === 0;
      const request = ++filesRequestRef.current;
      try {
        const result = await listDesignFiles(backendId, sessionId);
        if (!isMounted() || request !== filesRequestRef.current) return;
        const htmlFiles = result.files.filter(
          path => typeof path === 'string' && /\.html?$/i.test(path)
        );
        const newlyAdded = htmlFiles.find(path => !previousFilesRef.current?.includes(path));
        const firstLoad = previousFilesRef.current === null;
        previousFilesRef.current = htmlFiles;
        setFiles(htmlFiles);
        const generated = htmlFiles.includes('design/index.html')
          ? 'design/index.html'
          : newlyAdded;
        const initial = firstLoad
          ? htmlFiles.includes('design/index.html')
            ? 'design/index.html'
            : htmlFiles[0]
          : undefined;
        const arrivedAfterEmpty = wasEmpty ? newlyAdded : undefined;
        const candidate = waitingForGeneratedRef.current
          ? generated
          : (initial ?? arrivedAfterEmpty);
        if (!docPathRef.current && candidate) {
          setGeneratedFile(candidate);
          waitingForGeneratedRef.current = false;
        }
        if (!quiet) setError('');
      } catch (e) {
        if (isMounted() && request === filesRequestRef.current && !quiet) setError(message(e));
      } finally {
        filesScanInFlightRef.current = false;
      }
    },
    [backendId, sessionId, isMounted, setError]
  );

  useEffect(() => {
    if (visible) void refresh();
  }, [visible, refresh]);
  useEffect(() => {
    if (!visible) return;
    let disposed = false;
    let timer: number | undefined;
    const poll = async () => {
      await refresh(true);
      const path = docPathRef.current;
      if (path) await pollRefresh(path);
      if (!disposed) timer = window.setTimeout(() => void poll(), POLL_MS);
    };
    timer = window.setTimeout(() => void poll(), POLL_MS);
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [visible, refresh, pollRefresh]);

  const docPath = design.doc?.path;
  useEffect(() => {
    let live = true;
    const id = ++previewRequestRef.current;
    if (!docPath) return;
    void buildDesignPreview(
      design.draft,
      docPath,
      path => getDesignAsset(backendId, sessionId, path),
      channel,
      design.draftRevision
    )
      .then(result => {
        if (live && isMounted() && id === previewRequestRef.current) setPreview(result);
      })
      .catch(e => {
        if (live && isMounted() && id === previewRequestRef.current) setError(message(e));
      });
    return () => {
      live = false;
    };
  }, [backendId, sessionId, docPath, design.draft, design.draftRevision, channel, isMounted, setError]);

  useEffect(() => {
    const handle = (event: MessageEvent) => {
      const frame = iframeRef.current;
      if (!frame?.contentWindow || event.source !== frame.contentWindow) return;
      const data = event.data as {
        type?: string;
        channel?: string;
        selection?: unknown;
        elementPath?: unknown;
        color?: unknown;
        backgroundColor?: unknown;
      } | null;
      if (!data || data.channel !== channel) return;
      if (data.type === 'zclaudia:design-select') {
        if (!isValidSelection(data.selection)) return;
        verifyRef.current = null;
        handleSelectionMessage(data.selection);
        return;
      }
      if (data.type === 'zclaudia:design-verify-result') {
        const pending = verifyRef.current;
        if (!pending) return;
        if (JSON.stringify(data.elementPath ?? []) !== JSON.stringify(pending.elementPath)) return;
        verifyRef.current = null;
        let mismatch = false;
        if (typeof data.color === 'string' && pending.expected.color) {
          mismatch ||= !colorsEquivalent(pending.expected.color, data.color);
        }
        if (typeof data.backgroundColor === 'string' && pending.expected.backgroundColor) {
          mismatch ||= !colorsEquivalent(pending.expected.backgroundColor, data.backgroundColor);
        }
        if (mismatch) setOverrideWarning(true);
      }
    };
    window.addEventListener('message', handle);
    return () => window.removeEventListener('message', handle);
  }, [channel, handleSelectionMessage, setOverrideWarning]);

  // The verify request must reach the rebuilt preview, so it is sent on the iframe's load event.
  const handleFrameLoad = useCallback(() => {
    const pending = verifyRef.current;
    const frame = iframeRef.current;
    if (!pending || !frame?.contentWindow) return;
    frame.contentWindow.postMessage(
      { type: 'zclaudia:design-verify', channel, elementPath: pending.elementPath },
      '*'
    );
  }, [channel]);

  const handleApply = async (operations: DesignEditOperation[]) => {
    const current = design.selection;
    if (!current) return;
    const pathKey = current.elementPath.join('.');
    const mergeKey = `${pathKey}:${operations
      .map(operation => (operation.kind === 'text' ? 'text' : `style:${operation.property}`))
      .join('+')}`;
    const applied = await apply(operations, `编辑元素 ${pathKey}`, mergeKey);
    if (!applied) return;
    const expected: { color?: string; backgroundColor?: string } = {};
    for (const operation of operations) {
      if (operation.kind !== 'style' || operation.value === null) continue;
      if (operation.property === 'color') expected.color = operation.value;
      else expected.backgroundColor = operation.value;
    }
    verifyRef.current =
      expected.color || expected.backgroundColor
        ? { elementPath: applied.elementPath, expected }
        : null;
  };

  useEffect(() => {
    if (!generatedFile || !files.includes(generatedFile)) return;
    void load(generatedFile);
    setGeneratedFile(null);
  }, [files, generatedFile, load]);

  const prefill = (content: string) => {
    const state = useComposerStore.getState();
    const existing =
      state.pendingPrefills[sessionId]?.content ?? state.drafts[sessionId]?.content ?? '';
    const combined = existing.trim() ? `${existing.trimEnd()}\n\n${content}` : content;
    state.setPendingPrefill(sessionId, combined);
    setPrefillNotice(true);
  };
  const generate = () => {
    waitingForGeneratedRef.current = true;
    prefill(
      `Create or update a polished static HTML/CSS page at design/index.html in this workspace${workingDirectory ? ` (${workingDirectory})` : ''}. Use local files in the design/ folder with relative paths; do not use JavaScript to render the page or depend on CDN/external resources. Save the page so it appears in the Design panel. Keep the existing project context${projectId ? ` for project ${projectId}` : ''}.`
    );
  };
  const handoff = () => {
    if (!design.doc || !design.selection || design.dirty) return;
    const snippet = (design.selection.sourceText ?? design.selection.text).slice(0, 1000);
    prefill(
      `Modify the selected element in ${design.doc.path}. Element: <${design.selection.tagName}>; text: ${JSON.stringify(snippet)}; element path: ${design.selection.elementPath.join('.')}. Please update the HTML file and preserve the surrounding design.`
    );
  };

  return (
    <div data-testid="design-panel" className="flex h-full min-h-0 flex-col">
      <DesignToolbar
        docPath={design.doc?.path ?? null}
        files={files}
        busy={design.busy}
        dirty={design.dirty}
        canUndo={design.canUndo}
        canRedo={design.canRedo}
        hasSelection={!!design.selection}
        onFileSelect={path => {
          if (!design.dirty && !design.busy) void load(path);
        }}
        onRefresh={() => void refresh()}
        onGenerate={generate}
        onHandoff={handoff}
        onUndo={() => void undo()}
        onRedo={() => void redo()}
        onSave={() => void save()}
        onReload={() => void reload()}
      />
      {prefillNotice && (
        <div
          role="status"
          className="border-b border-border px-3 py-1.5 text-xs text-muted-foreground"
        >
          已填入当前聊天，补充需求后发送。
        </div>
      )}
      {design.dirty && (
        <div
          role="status"
          className="border-b border-border px-3 py-1.5 text-xs text-muted-foreground"
        >
          有未保存的修改；请先保存后再交给 Agent 修改。
        </div>
      )}
      {design.externalChange && (
        <div role="status" className="border-b border-border px-3 py-1.5 text-xs text-warning">
          此文件已在其他位置更新。你的草稿仍保留；重新载入可载入最新版本。
        </div>
      )}
      {design.error && (
        <div role="alert" className="border-b border-border px-3 py-1.5 text-xs text-destructive">
          {design.error}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        <div className="min-h-52 flex-1 bg-background">
          <iframe
            ref={iframeRef}
            title="设计预览"
            sandbox="allow-scripts"
            srcDoc={preview || EMPTY_HTML}
            className="h-full min-h-52 w-full border-0"
            onLoad={handleFrameLoad}
          />
        </div>
        <div className="max-h-64 min-h-36 shrink-0 overflow-y-auto border-t border-border p-3">
          <SelectionEditor
            selection={design.selection}
            busy={design.busy}
            overrideWarning={design.overrideWarning}
            onApply={handleApply}
          />
        </div>
        <div className="shrink-0 border-t border-border">
          <button
            type="button"
            aria-expanded={versionsOpen}
            aria-label="版本历史"
            onClick={() => setVersionsOpen(value => !value)}
            className="flex w-full items-center gap-1 px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronDown
              size={12}
              className={`transition-transform ${versionsOpen ? '' : '-rotate-90'}`}
            />
            版本历史
          </button>
          {versionsOpen && (
            <div className="max-h-72 overflow-y-auto px-3 pb-3">
              <VersionHistory
                backendId={backendId}
                sessionId={sessionId}
                docPath={design.doc?.path ?? null}
                currentSource={design.doc?.source ?? null}
                busy={design.busy}
                dirty={design.dirty}
                restore={design.restoreSnapshot}
                onRestored={() => void design.reload()}
                onReload={() => void design.reload()}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
