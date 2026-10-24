import { useEffect, useState } from 'react';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import { getDesignAsset, getDesignSnapshotDetail, getDesignSnapshotFile } from '../api';
import type { DesignSnapshotDetail } from '../api';
import { formatBytes, lineDiff } from '../diff';
import type { DiffLine } from '../diff';
import type { DesignSnapshotFile } from '../types';

const KIND_LABEL: Record<DesignSnapshotFile['kind'], string> = {
  entry: 'Entry',
  css: 'CSS',
  image: 'Image',
  font: 'Font',
  video: 'Video',
  other: 'File',
};

function decodeBase64Utf8(data: string): string {
  const binary = atob(data);
  const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function isTextFile(file: DesignSnapshotFile): boolean {
  if (file.kind === 'entry' || file.kind === 'css') return true;
  const mime = (file.mime ?? '').toLowerCase();
  return mime.startsWith('text/') || /json|javascript|xml|svg/.test(mime);
}

interface DiffHunk {
  lines: DiffLine[];
  /** Count of identical lines collapsed before this hunk. */
  omittedBefore: number;
}

const CONTEXT = 3;

/** Collapse long runs of unchanged lines: keep `context` lines around changes. */
function buildHunks(lines: DiffLine[], context = CONTEXT): DiffHunk[] {
  const changed = lines
    .map((line, index) => (line.type === 'same' ? -1 : index))
    .filter(index => index >= 0);
  if (changed.length === 0) {
    return lines.length === 0 ? [] : [{ lines: lines.slice(0, context), omittedBefore: Math.max(0, lines.length - context) }];
  }
  const ranges: Array<[number, number]> = [];
  for (const index of changed) {
    const start = Math.max(0, index - context);
    const end = Math.min(lines.length, index + context + 1);
    const last = ranges[ranges.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else ranges.push([start, end]);
  }
  return ranges.map(([start, end], i) => ({
    lines: lines.slice(start, end),
    omittedBefore: i === 0 ? start : start - ranges[i - 1][1],
  }));
}

interface FileDiffView {
  file: DesignSnapshotFile;
  binary: boolean;
  lines?: DiffLine[];
  hasChanges?: boolean;
  truncated?: boolean;
  /** The file no longer exists in the current workspace. */
  missing?: boolean;
  /** Binary comparison result against the current file. */
  binarySame?: boolean;
  error?: string;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface VersionDiffProps {
  open: boolean;
  backendId: string;
  sessionId: string;
  snapshotId: string;
  /** Current entry document source from disk (doc.source), or null. */
  currentSource: string | null;
  onClose: () => void;
}

/** Per-file diff of one snapshot against the current document state. */
export function VersionDiff({
  open,
  backendId,
  sessionId,
  snapshotId,
  currentSource,
  onClose,
}: VersionDiffProps) {
  const [detail, setDetail] = useState<DesignSnapshotDetail | null>(null);
  const [views, setViews] = useState<FileDiffView[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let live = true;
    setDetail(null);
    setViews(null);
    setError('');
    const load = async () => {
      try {
        const got = await getDesignSnapshotDetail(backendId, sessionId, snapshotId);
        if (!live) return;
        setDetail(got);
        const entryPath = got.summary.entryPath;
        const built = await Promise.all(
          got.files.map(async (file): Promise<FileDiffView> => {
            let old: string;
            try {
              old = (await getDesignSnapshotFile(backendId, sessionId, snapshotId, file.path)).data;
            } catch (e) {
              return { file, binary: !isTextFile(file), error: message(e) };
            }
            if (file.kind === 'entry' || file.path === entryPath) {
              const missing = currentSource == null;
              const diff = lineDiff(decodeBase64Utf8(old), missing ? '' : currentSource);
              return {
                file,
                binary: false,
                missing,
                lines: diff.lines,
                hasChanges: diff.lines.some(line => line.type !== 'same'),
                truncated: diff.truncated,
              };
            }
            try {
              const asset = await getDesignAsset(backendId, sessionId, file.path);
              if (isTextFile(file)) {
                const diff = lineDiff(decodeBase64Utf8(old), decodeBase64Utf8(asset.data));
                return {
                  file,
                  binary: false,
                  lines: diff.lines,
                  hasChanges: diff.lines.some(line => line.type !== 'same'),
                  truncated: diff.truncated,
                };
              }
              return { file, binary: true, binarySame: asset.data === old };
            } catch {
              // Current file is gone: text shows as fully removed, binary as deleted.
              if (isTextFile(file)) {
                const diff = lineDiff(decodeBase64Utf8(old), '');
                return {
                  file,
                  binary: false,
                  missing: true,
                  lines: diff.lines,
                  hasChanges: true,
                  truncated: diff.truncated,
                };
              }
              return { file, binary: true, missing: true };
            }
          })
        );
        if (live) setViews(built);
      } catch (e) {
        if (live) setError(message(e));
      }
    };
    void load();
    return () => {
      live = false;
    };
  }, [open, backendId, sessionId, snapshotId, currentSource]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      ariaLabel="Version diff"
      title={`Version diff${detail?.summary.label ? ` · ${detail.summary.label}` : ''}`}
      size="lg"
      footer={
        <Button size="sm" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="flex flex-col gap-4 p-4">
        {error && (
          <div role="alert" className="text-xs text-destructive">
            Failed to load diff: {error}
          </div>
        )}
        {!detail && !error && <div className="text-xs text-muted-foreground">Loading diff…</div>}
        {detail && !views && !error && (
          <div className="text-xs text-muted-foreground">Reading file contents…</div>
        )}
        {views?.map(view => (
          <FileDiffSection key={view.file.path} view={view} />
        ))}
      </div>
    </Modal>
  );
}

export interface LineDiffViewProps {
  /** lineDiff 输出（a=旧，b=新）。 */
  lines: DiffLine[];
  /** 输入或输出超过行数上限被截断时展示提示。 */
  truncated?: boolean;
}

/**
 * 行级差异表（P2 §5.2）：增/删/同行 + 双侧行号，长段相同行折叠。版本差异
 * （VersionDiff）与未保存差异（草稿 vs 磁盘）共用同一套样式。
 */
export function LineDiffView({ lines, truncated = false }: LineDiffViewProps) {
  const hunks = buildHunks(lines);
  return (
    <>
      <div className="flex flex-col rounded-md border border-border">
        {hunks.map((hunk, hunkIndex) => (
          <div key={hunkIndex} className="flex flex-col">
            {hunk.omittedBefore > 0 && (
              <div className="bg-secondary/60 px-2 py-0.5 text-center font-mono text-[10px] text-muted-foreground">
                ⋯ {hunk.omittedBefore} identical lines omitted ⋯
              </div>
            )}
            {hunk.lines.map((line, lineIndex) => (
              <div
                key={lineIndex}
                className={`flex gap-2 px-2 py-px font-mono text-[10px] leading-4 ${
                  line.type === 'add'
                    ? 'bg-success/10 text-success'
                    : line.type === 'del'
                      ? 'bg-destructive/10 text-destructive'
                      : 'text-muted-foreground'
                }`}
              >
                <span className="w-8 shrink-0 select-none text-right opacity-60">
                  {line.aLine ?? ''}
                </span>
                <span className="w-8 shrink-0 select-none text-right opacity-60">
                  {line.bLine ?? ''}
                </span>
                <span className="shrink-0 select-none">
                  {line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' '}
                </span>
                <span className="whitespace-pre-wrap break-all">{line.text}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      {truncated && (
        <div className="text-[10px] text-muted-foreground">Diff exceeds 5000 lines and was truncated.</div>
      )}
    </>
  );
}

function FileDiffSection({ view }: { view: FileDiffView }) {
  return (
    <section aria-label={`Diff ${view.file.path}`} className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-xs">
        <span className="truncate font-mono text-foreground">{view.file.path}</span>
        <Badge label={KIND_LABEL[view.file.kind]} />
        <span className="ml-auto shrink-0 text-muted-foreground">{formatBytes(view.file.bytes)}</span>
      </div>
      {view.error && (
        <div role="alert" className="text-xs text-destructive">
          Read failed: {view.error}
        </div>
      )}
      {view.binary ? (
        <div className="text-xs text-muted-foreground">
          Binary file · {formatBytes(view.file.bytes)} ·{' '}
          {view.missing
            ? 'Currently deleted'
            : view.binarySame === undefined
              ? 'Cannot compare (failed to read the current file)'
              : view.binarySame
                ? 'Same as current'
                : 'Differs from current'}
        </div>
      ) : !view.hasChanges ? (
        <div className="text-xs text-muted-foreground">Same as the current version</div>
      ) : (
        <>
          {view.missing && (
            <div className="text-xs text-warning">The current file no longer exists; below is the snapshot content.</div>
          )}
          <LineDiffView lines={view.lines ?? []} truncated={view.truncated} />
        </>
      )}
    </section>
  );
}
