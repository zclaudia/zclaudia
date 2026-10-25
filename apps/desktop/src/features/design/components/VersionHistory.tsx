import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { Button, IconButton } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import { createDesignSnapshot, getDesignSnapshotDetail, listDesignSnapshots } from '../api';
import type { DesignConflictFile, DesignSnapshotDetail, DesignSnapshotSummary } from '../api';
import { formatBytes } from '../diff';
import type { DesignSnapshotFile } from '../types';
import { VersionDiff } from './VersionDiff';

const SOURCE_LABEL: Record<DesignSnapshotSummary['source'], string> = {
  save: 'Saved',
  manual: 'Manual',
  'pre-restore': 'Before restore',
  restore: 'After restore',
};

const KIND_LABEL: Record<DesignSnapshotFile['kind'], string> = {
  entry: 'Entry',
  css: 'CSS',
  image: 'Image',
  font: 'Font',
  video: 'Video',
  other: 'File',
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
}

/** Client's belief about the current disk state: the snapshot itself. */
function expectedRevisionsOf(detail: DesignSnapshotDetail): Record<string, string> {
  return Object.fromEntries(detail.files.map(file => [file.path, file.sha256]));
}

export interface VersionHistoryProps {
  backendId: string;
  sessionId: string;
  /** Entry path of the current document; null disables the section. */
  docPath: string | null;
  /** Current entry source from disk (doc.source), used by the diff view. */
  currentSource: string | null;
  busy: boolean;
  /** A dirty draft would be discarded by a restore; surfaced as a warning. */
  dirty: boolean;
  /** Hook-owned restore: performs the restore and reloads on success. */
  restore: (
    snapshotId: string,
    expectedRevisions: Record<string, string>,
    options?: { confirmIncomplete?: boolean }
  ) => Promise<{ ok: boolean; conflictFiles?: DesignConflictFile[]; errorCode?: string }>;
  /** Called after a successful restore (panel force-reloads the document). */
  onRestored: () => void;
  /** Called when the user follows the conflict guidance to reload. */
  onReload: () => void;
}

/** Version list of the current document with manual capture, diff and restore. */
export function VersionHistory({
  backendId,
  sessionId,
  docPath,
  currentSource,
  busy,
  dirty,
  restore,
  onRestored,
  onReload,
}: VersionHistoryProps) {
  const [summaries, setSummaries] = useState<DesignSnapshotSummary[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [labelValue, setLabelValue] = useState('');
  const [capturing, setCapturing] = useState(false);
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);
  const [diffId, setDiffId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<DesignSnapshotDetail | null>(null);
  const [confirmStage, setConfirmStage] = useState<'review' | 'incomplete'>('review');
  const [conflictFiles, setConflictFiles] = useState<DesignConflictFile[] | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const requestRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!docPath) return;
    const request = ++requestRef.current;
    try {
      const list = await listDesignSnapshots(backendId, sessionId, docPath);
      if (request !== requestRef.current) return;
      setSummaries(list);
      setError('');
    } catch (e) {
      if (request !== requestRef.current) return;
      setError(message(e));
    }
  }, [backendId, docPath, sessionId]);

  useEffect(() => {
    setSummaries(null);
    setExpandedId(null);
    if (docPath) void refresh();
  }, [docPath, refresh]);

  /** 保存版本: manual capture of the document as it is on disk. */
  const saveVersion = async () => {
    if (!docPath || capturing || busy || dirty) return;
    setCapturing(true);
    setError('');
    setNotice('');
    try {
      const trimmed = labelValue.trim();
      const summary = await createDesignSnapshot(backendId, {
        sessionId,
        path: docPath,
        source: 'manual',
        ...(trimmed ? { label: trimmed } : {}),
      });
      setLabelValue('');
      setNotice(
        summary.complete ? 'Version snapshot created.' : 'Version snapshot created (incomplete: some assets were not captured).'
      );
      await refresh();
    } catch (e) {
      setError(`Failed to create snapshot: ${message(e)}`);
    } finally {
      setCapturing(false);
    }
  };

  const startRestore = async (summary: DesignSnapshotSummary) => {
    if (loadingDetailId || restoring) return;
    setLoadingDetailId(summary.id);
    setError('');
    setNotice('');
    try {
      const detail = await getDesignSnapshotDetail(backendId, sessionId, summary.id);
      setConflictFiles(null);
      setConfirmStage('review');
      setConfirm(detail);
    } catch (e) {
      setError(message(e));
    } finally {
      setLoadingDetailId(null);
    }
  };

  const closeConfirm = () => {
    if (restoring) return;
    setConfirm(null);
    setConflictFiles(null);
    setConfirmStage('review');
  };

  const executeRestore = async () => {
    if (!confirm || restoring) return;
    setRestoring(true);
    setError('');
    try {
      // The client has already double-confirmed incomplete snapshots, so the
      // request carries confirmIncomplete for them; complete ones omit it.
      const outcome = await restore(
        confirm.summary.id,
        expectedRevisionsOf(confirm),
        confirm.summary.complete ? {} : { confirmIncomplete: true }
      );
      if (outcome.ok) {
        setConfirm(null);
        setConflictFiles(null);
        setConfirmStage('review');
        setNotice('Restored to the selected version.');
        onRestored();
        void refresh();
        return;
      }
      if (outcome.errorCode === 'RESTORE_CONFLICT') {
        setConflictFiles(outcome.conflictFiles ?? []);
        return;
      }
      if (outcome.errorCode === 'SNAPSHOT_INCOMPLETE') {
        setConfirmStage('incomplete');
        return;
      }
      setError(outcome.errorCode ? `Restore failed: ${outcome.errorCode}` : 'Restore failed.');
    } finally {
      setRestoring(false);
    }
  };

  const onConfirmClick = () => {
    if (!confirm) return;
    // Incomplete snapshots need a second confirmation that shows the
    // un-captured resources before the restore actually runs.
    if (!confirm.summary.complete && confirmStage === 'review') {
      setConfirmStage('incomplete');
      return;
    }
    void executeRestore();
  };

  const detail = confirm;

  return (
    <section aria-label="Version history" className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1">
          <span className="shrink-0 whitespace-nowrap text-[11px] font-medium text-muted-foreground">
            Version history
          </span>
          <IconButton size="sm" aria-label="Refresh version list" onClick={() => void refresh()}>
            <RefreshCw size={12} />
          </IconButton>
        </div>
        <div className="flex items-center gap-1">
          <Input
            aria-label="Version note"
            placeholder="Version note (optional)"
            value={labelValue}
            onChange={e => setLabelValue(e.target.value)}
            disabled={!docPath}
            className="h-6 min-w-0 flex-1 px-2 py-0 text-[11px]"
          />
          <Button
            size="sm"
            className="shrink-0 whitespace-nowrap"
            onClick={() => void saveVersion()}
            disabled={!docPath || busy || dirty || capturing}
            title={dirty ? 'Save your changes before creating a version snapshot' : 'Save the current on-disk content as a version'}
          >
            Save version
          </Button>
        </div>
      </div>
      {notice && (
        <div role="status" className="text-xs text-muted-foreground">
          {notice}
        </div>
      )}
      {error && (
        <div role="alert" className="text-xs text-destructive">
          {error}
        </div>
      )}
      {!docPath ? (
        <p className="text-xs text-muted-foreground">Select an HTML file first.</p>
      ) : summaries === null && !error ? (
        <p className="text-xs text-muted-foreground">Loading versions…</p>
      ) : summaries !== null && summaries.length === 0 ? (
        <p className="text-xs text-muted-foreground">No version snapshots yet; they appear after saving or creating one manually.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {summaries?.map(summary => (
            <li
              key={summary.id}
              className="flex flex-col gap-1 rounded-md border border-border px-2 py-1.5"
            >
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-foreground">{formatTime(summary.createdAt)}</span>
                <Badge label={SOURCE_LABEL[summary.source]} tone="neutral" />
                {summary.label && <span className="truncate text-foreground">{summary.label}</span>}
                {summary.complete ? (
                  <Badge label="Complete" tone="success" />
                ) : (
                  <button
                    type="button"
                    aria-expanded={expandedId === summary.id}
                    aria-label={`Incomplete reasons ${summary.id}`}
                    onClick={() => setExpandedId(expandedId === summary.id ? null : summary.id)}
                    className="rounded text-2xs text-warning underline underline-offset-2"
                  >
                    Incomplete
                  </button>
                )}
                <span className="ml-auto text-muted-foreground">
                  {summary.fileCount} files · {formatBytes(summary.totalBytes)}
                </span>
              </div>
              {!summary.complete && expandedId === summary.id && (
                <ul className="flex flex-col gap-0.5 rounded bg-secondary/60 px-2 py-1 text-[10px] text-warning">
                  {summary.incompleteReasons.length === 0 ? (
                    <li>some assets not captured</li>
                  ) : (
                    summary.incompleteReasons.map(reason => <li key={reason}>{reason}</li>)
                  )}
                </ul>
              )}
              <div className="flex items-center gap-1">
                <Button size="sm" onClick={() => setDiffId(summary.id)}>
                  View diff
                </Button>
                <Button
                  size="sm"
                  onClick={() => void startRestore(summary)}
                  disabled={busy || loadingDetailId !== null || restoring}
                >
                  {loadingDetailId === summary.id ? 'Loading…' : 'Restore this version'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {diffId && docPath && (
        <VersionDiff
          open
          backendId={backendId}
          sessionId={sessionId}
          snapshotId={diffId}
          currentSource={currentSource}
          onClose={() => setDiffId(null)}
        />
      )}
      {detail && (
        <Modal
          open
          onClose={closeConfirm}
          ariaLabel="Restore this version"
          title="Restore this version"
          size="md"
          footer={
            conflictFiles ? (
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    setConfirm(null);
                    setConflictFiles(null);
                    onReload();
                  }}
                >
                  Reload
                </Button>
                <Button size="sm" onClick={closeConfirm}>
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="flex justify-end gap-2">
                <Button size="sm" onClick={closeConfirm}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={onConfirmClick}
                  disabled={restoring}
                >
                  {restoring
                    ? 'Restoring…'
                    : confirmStage === 'incomplete'
                      ? 'Restore anyway'
                      : 'Confirm restore'}
                </Button>
              </div>
            )
          }
        >
          <div className="flex flex-col gap-3 p-4 text-xs">
            {conflictFiles ? (
              <>
                <div role="alert" className="text-destructive">
                  The following files changed after the snapshot; the restore was canceled. Reload the latest content and try again.
                </div>
                <ul className="flex flex-col gap-1 rounded-md border border-border px-2 py-1.5">
                  {conflictFiles.map(file => (
                    <li key={file.path} className="font-mono text-[11px]">
                      {file.path}
                      {file.reason ? <span className="text-muted-foreground"> · {file.reason}</span> : null}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                <div className="text-muted-foreground">
                  Workspace files will be restored to the version of {formatTime(detail.summary.createdAt)} ({SOURCE_LABEL[detail.summary.source]}
                  {detail.summary.label ? ` · ${detail.summary.label}` : ''}). Files outside the manifest will not be touched.
                </div>
                {dirty && (
                  <div className="text-warning">There are unsaved changes; restoring will discard them.</div>
                )}
                {!detail.summary.complete && (
                  <div className="rounded-md border border-border bg-secondary/60 px-2 py-1.5 text-warning">
                    This snapshot is incomplete; the following assets were not captured:
                    <ul className="mt-1 flex flex-col gap-0.5">
                      {detail.summary.incompleteReasons.length === 0 ? (
                        <li>some assets not captured</li>
                      ) : (
                        detail.summary.incompleteReasons.map(reason => <li key={reason}>{reason}</li>)
                      )}
                    </ul>
                    {confirmStage === 'incomplete' && (
                      <div className="mt-1">Acknowledged the uncaptured assets above; to restore anyway, click "Restore anyway" again.</div>
                    )}
                  </div>
                )}
                <div className="text-muted-foreground">
                  {detail.files.length} files will be written:
                </div>
                <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border border-border px-2 py-1.5">
                  {detail.files.map(file => (
                    <li key={file.path} className="flex items-center gap-2 text-[11px]">
                      <span className="truncate font-mono">{file.path}</span>
                      <Badge label={KIND_LABEL[file.kind]} />
                      <span className="ml-auto shrink-0 text-muted-foreground">
                        {formatBytes(file.bytes)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}
