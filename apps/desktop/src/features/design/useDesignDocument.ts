import { useCallback, useEffect, useRef, useState } from 'react';
import { useIsMounted } from '../../hooks/useIsMounted';
import {
  createDesignSnapshot,
  DesignSnapshotError,
  getDesignDocument,
  putDesignDocument,
  restoreDesignSnapshot,
} from './api';
import type { DesignConflictFile } from './api';
import { EditHistory } from './history/edit-history';
import { applyEditTransaction } from './html/edit-engine';
import { sha256Hex } from './html/hash';
import { DesignEditError } from './types';
import type { DesignDocument, DesignEditOperation, DesignSelection } from './types';

const HISTORY_INVALID_MESSAGE = '编辑历史已失效，已重新载入';

/** Result of a restore attempt: ok, or the failure shape the UI needs. */
export interface DesignRestoreOutcome {
  ok: boolean;
  /** Conflicting files when the server rejected with RESTORE_CONFLICT. */
  conflictFiles?: DesignConflictFile[];
  /** Machine-readable error code (e.g. RESTORE_CONFLICT, SNAPSHOT_INCOMPLETE). */
  errorCode?: string;
}

const isConflict = (error: unknown): boolean =>
  /conflict|revision|changed/i.test(error instanceof Error ? error.message : String(error));

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Map an engine rejection code to a user-facing hint. */
function editErrorMessage(error: unknown): string {
  if (!(error instanceof DesignEditError)) return message(error);
  switch (error.code) {
    case 'REVISION_MISMATCH':
    case 'TEXT_MISMATCH':
      return '所选元素已变化，请重新选择后再试';
    case 'ELEMENT_NOT_FOUND':
      return '所选元素已不存在，请重新选择后再试';
    case 'TAG_MISMATCH':
      return '所选元素类型已变化，请重新选择后再试';
    case 'NOT_PLAIN_TEXT':
      return '该元素包含子元素，只能修改纯文本元素的文字';
    case 'IMPLICIT_ELEMENT':
      return '该元素在源码中没有明确位置，无法修改';
    case 'DUPLICATE_ATTRIBUTE':
      return '该元素的开始标签存在重复属性，无法安全修改';
    case 'MALFORMED_HTML':
      return '该元素附近的源码无法解析，请先修复后再编辑';
    case 'INVALID_VALUE':
      return '颜色值无效，请输入合法的 CSS 颜色';
    case 'EMPTY_TRANSACTION':
      return '没有需要应用的修改';
    default:
      return message(error);
  }
}

export interface UseDesignDocumentOptions {
  backendId: string;
  sessionId: string;
}

export function useDesignDocument({ backendId, sessionId }: UseDesignDocumentOptions) {
  const historyHolder = useRef<EditHistory | null>(null);
  if (historyHolder.current == null) historyHolder.current = new EditHistory();
  const history = historyHolder.current;

  const [doc, setDoc] = useState<DesignDocument | null>(null);
  const [draft, setDraft] = useState('');
  const [draftRevision, setDraftRevision] = useState('');
  const [selection, setSelection] = useState<DesignSelection | null>(null);
  const [externalChange, setExternalChange] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [overrideWarning, setOverrideWarning] = useState(false);
  const [historyFlags, setHistoryFlags] = useState({ canUndo: false, canRedo: false });

  // Mirrors of the state above for use inside async callbacks without stale closures.
  const docRef = useRef<DesignDocument | null>(null);
  const draftRef = useRef('');
  const revisionRef = useRef('');
  const selectionRef = useRef<DesignSelection | null>(null);
  const busyRef = useRef(false);
  const requestRef = useRef(0);
  const isMounted = useIsMounted();

  useEffect(() => {
    const requests = requestRef;
    return () => {
      ++requests.current;
    };
  }, []);

  const syncHistory = useCallback(() => {
    setHistoryFlags({ canUndo: history.canUndo, canRedo: history.canRedo });
  }, [history]);

  /** Unconditionally take over the state with a freshly fetched document. */
  const adoptDocument = useCallback(
    async (next: DesignDocument) => {
      const revision = await sha256Hex(next.source);
      if (!isMounted()) return;
      docRef.current = next;
      draftRef.current = next.source;
      revisionRef.current = revision;
      selectionRef.current = null;
      history.rebuild(next.source);
      setDoc(next);
      setDraft(next.source);
      setDraftRevision(revision);
      setSelection(null);
      setExternalChange(false);
      setError('');
      syncHistory();
    },
    [history, isMounted, syncHistory]
  );

  /** Fetch a document from disk and adopt it (skipped when it is unchanged). */
  const load = useCallback(
    async (path: string, force = false) => {
      const request = ++requestRef.current;
      try {
        const next = await getDesignDocument(backendId, sessionId, path);
        if (!isMounted() || request !== requestRef.current || busyRef.current) return;
        const current = docRef.current;
        if (
          !force &&
          current?.path === next.path &&
          current.revision === next.revision &&
          current.source === next.source
        )
          return;
        await adoptDocument(next);
      } catch (e) {
        if (isMounted() && request === requestRef.current) setError(message(e));
      }
    },
    [adoptDocument, backendId, isMounted, sessionId]
  );

  /** Force a refetch of the current document, discarding any draft. */
  const reload = useCallback(async () => {
    const path = docRef.current?.path;
    if (!path || busyRef.current) return;
    await load(path, true);
  }, [load]);

  /**
   * Handle a selection message from the preview iframe. Selections built
   * against a different draft revision (a late iframe message) are ignored.
   */
  const handleSelectionMessage = useCallback((next: DesignSelection) => {
    if (next.base !== revisionRef.current) return;
    selectionRef.current = next;
    setSelection(next);
    setOverrideWarning(false);
  }, []);

  /**
   * Apply operations to the current selection. Returns the updated selection,
   * or null when nothing was applied (error state carries the hint).
   */
  const apply = useCallback(
    async (
      operations: DesignEditOperation[],
      label: string,
      mergeKey?: string
    ): Promise<DesignSelection | null> => {
      const locator = selectionRef.current;
      const before = draftRef.current;
      if (!locator || busyRef.current || operations.length === 0) return null;
      busyRef.current = true;
      setBusy(true);
      setError('');
      try {
        const result = await applyEditTransaction(before, {
          baseRevision: revisionRef.current,
          locator,
          operations,
        });
        if (!isMounted()) return null;
        draftRef.current = result.source;
        revisionRef.current = result.revision;
        selectionRef.current = result.selection;
        setDraft(result.source);
        setDraftRevision(result.revision);
        setSelection(result.selection);
        setOverrideWarning(false);
        history.record({ before, after: result.source, label, at: Date.now(), mergeKey });
        syncHistory();
        return result.selection;
      } catch (e) {
        if (isMounted()) setError(editErrorMessage(e));
        return null;
      } finally {
        busyRef.current = false;
        if (isMounted()) setBusy(false);
      }
    },
    [history, isMounted, syncHistory]
  );

  /** Shared body of undo/redo: swap the draft, drop the selection. */
  const moveTo = useCallback(
    async (nextSource: string | null) => {
      if (nextSource === null) {
        // Baseline drift or empty history: force a reload from disk.
        const path = docRef.current?.path;
        if (path) await load(path, true);
        if (isMounted()) setError(HISTORY_INVALID_MESSAGE);
        return;
      }
      busyRef.current = true;
      setBusy(true);
      try {
        const revision = await sha256Hex(nextSource);
        if (!isMounted()) return;
        draftRef.current = nextSource;
        revisionRef.current = revision;
        selectionRef.current = null;
        setDraft(nextSource);
        setDraftRevision(revision);
        setSelection(null);
        syncHistory();
      } finally {
        busyRef.current = false;
        if (isMounted()) setBusy(false);
      }
    },
    [isMounted, load, syncHistory]
  );

  const undo = useCallback(async () => {
    if (busyRef.current) return;
    await moveTo(history.undo(draftRef.current));
  }, [history, moveTo]);

  const redo = useCallback(async () => {
    if (busyRef.current) return;
    await moveTo(history.redo(draftRef.current));
  }, [history, moveTo]);

  /** Write the draft to disk; a conflict keeps the draft and flags the change. */
  const save = useCallback(async () => {
    const current = docRef.current;
    if (!current || draftRef.current === current.source || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    ++requestRef.current; // invalidate in-flight document loads, as before
    try {
      const saved = await putDesignDocument(backendId, {
        sessionId,
        path: current.path,
        source: draftRef.current,
        expectedRevision: current.revision,
      });
      if (!isMounted()) return;
      docRef.current = saved;
      draftRef.current = saved.source;
      setDoc(saved);
      setDraft(saved.source);
      const revision = await sha256Hex(saved.source);
      if (!isMounted()) return;
      revisionRef.current = revision;
      setDraftRevision(revision);
      history.markSaved(saved.source);
      syncHistory();
      setExternalChange(false);
      // The save state above is already committed; a snapshot failure must
      // not turn the save into a failure, it only surfaces as a hint.
      try {
        await createDesignSnapshot(backendId, {
          sessionId,
          path: saved.path,
          source: 'save',
        });
      } catch (snapshotError) {
        if (isMounted()) setError(`保存成功，但快照未创建：${message(snapshotError)}`);
      }
    } catch (e) {
      if (isMounted()) {
        setError(message(e));
        if (isConflict(e)) setExternalChange(true);
      }
    } finally {
      busyRef.current = false;
      if (isMounted()) setBusy(false);
    }
  }, [backendId, history, isMounted, sessionId, syncHistory]);

  /**
   * Compare a freshly fetched disk document against the current state during
   * polling: a dirty draft is kept and flagged; a clean draft silently adopts
   * the new version (rebuilding the history baseline).
   */
  const checkExternal = useCallback(
    async (next: DesignDocument) => {
      if (busyRef.current) return;
      const current = docRef.current;
      if (!current) return;
      if (draftRef.current !== current.source && next.path === current.path) {
        if (next.revision === current.revision && next.source === current.source) return;
        setExternalChange(true);
        return;
      }
      if (
        next.path === current.path &&
        next.revision === current.revision &&
        next.source === current.source
      )
        return;
      await adoptDocument(next);
    },
    [adoptDocument]
  );

  /** Polling variant of checkExternal that performs the fetch itself, with request-staleness guards. */
  const pollRefresh = useCallback(
    async (path: string) => {
      const request = ++requestRef.current;
      try {
        const next = await getDesignDocument(backendId, sessionId, path);
        if (!isMounted() || request !== requestRef.current || busyRef.current) return;
        await checkExternal(next);
      } catch (e) {
        if (isMounted() && request === requestRef.current) setError(message(e));
      }
    },
    [backendId, checkExternal, isMounted, sessionId]
  );

  /**
   * Restore a snapshot and reload the document from disk afterwards (the
   * history baseline is rebuilt by the reload). A RESTORE_CONFLICT keeps the
   * disk untouched and returns the conflicting files for the UI; it is not
   * pushed into the global error state because the UI renders the conflict
   * list itself.
   */
  const restoreSnapshot = useCallback(
    async (
      snapshotId: string,
      expectedRevisions: Record<string, string>,
      options?: { confirmIncomplete?: boolean }
    ): Promise<DesignRestoreOutcome> => {
      const current = docRef.current;
      if (!current || busyRef.current) return { ok: false, errorCode: 'BUSY' };
      busyRef.current = true;
      setBusy(true);
      setError('');
      try {
        await restoreDesignSnapshot(backendId, {
          sessionId,
          snapshotId,
          expectedRevisions,
          ...(options?.confirmIncomplete === undefined
            ? {}
            : { confirmIncomplete: options.confirmIncomplete }),
        });
        if (!isMounted()) return { ok: false, errorCode: 'UNMOUNTED' };
        // Release the busy flag first: `load` skips adoption while busy.
        busyRef.current = false;
        setBusy(false);
        await load(current.path, true);
        return { ok: isMounted() };
      } catch (e) {
        const snapshotError = e instanceof DesignSnapshotError ? e : null;
        const outcome: DesignRestoreOutcome = {
          ok: false,
          errorCode: snapshotError?.code,
          conflictFiles: snapshotError?.files ?? [],
        };
        // Conflict and incomplete-snapshot rejections are rendered by the
        // restore dialog itself, not as a global panel error.
        const handledByUi =
          outcome.errorCode === 'RESTORE_CONFLICT' || outcome.errorCode === 'SNAPSHOT_INCOMPLETE';
        if (isMounted() && !handledByUi) setError(message(e));
        return outcome;
      } finally {
        busyRef.current = false;
        if (isMounted()) setBusy(false);
      }
    },
    [backendId, isMounted, load, sessionId]
  );

  return {
    doc,
    draft,
    draftRevision,
    selection,
    externalChange,
    error,
    busy,
    overrideWarning,
    dirty: !!doc && draft !== doc.source,
    canUndo: historyFlags.canUndo,
    canRedo: historyFlags.canRedo,
    load,
    reload,
    handleSelectionMessage,
    apply,
    undo,
    redo,
    save,
    restoreSnapshot,
    checkExternal,
    pollRefresh,
    setError,
    setOverrideWarning,
  };
}
