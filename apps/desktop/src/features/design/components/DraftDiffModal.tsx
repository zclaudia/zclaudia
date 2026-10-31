import { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { DesignModal as Modal } from './DesignModal';
import { getDesignDocument } from '../api';
import { lineDiff } from '../diff';
import { LineDiffView } from './VersionDiff';

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1) || path;

/**
 * 未保存差异（P2 §5.2）：磁盘已保存内容 vs 当前草稿的行级对比。快照不暴露
 * 基线源码，打开时取一次磁盘文档（fileViewer 同样永远读磁盘）；展示复用
 * VersionDiff 抽出的 LineDiffView（同款增删样式）。
 */
export function DraftDiffModal({
  open,
  backendId,
  sessionId,
  path,
  draftSource,
  onClose,
}: {
  open: boolean;
  backendId: string;
  sessionId: string;
  path: string;
  draftSource: string;
  onClose: () => void;
}) {
  const [diskSource, setDiskSource] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let live = true;
    setDiskSource(null);
    setError('');
    getDesignDocument(backendId, sessionId, path)
      .then(doc => {
        if (live) setDiskSource(doc.source);
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, [open, backendId, sessionId, path]);

  const diff = diskSource === null ? null : lineDiff(diskSource, draftSource);
  const hasChanges = diff !== null && diff.lines.some(line => line.type !== 'same');

  return (
    <Modal
      open={open}
      onClose={onClose}
      ariaLabel="Unsaved changes"
      title={`Unsaved changes · ${baseName(path)}`}
      size="lg"
      footer={
        <Button size="sm" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="flex flex-col gap-3 p-4">
        {error && (
          <div role="alert" className="text-xs text-destructive">
            Failed to load diff: {error}
          </div>
        )}
        {diskSource === null && !error && (
          <div className="text-xs text-muted-foreground">Loading diff…</div>
        )}
        {diff !== null && !hasChanges && (
          <div className="text-xs text-muted-foreground">The draft matches the saved version.</div>
        )}
        {diff !== null && hasChanges && (
          <LineDiffView lines={diff.lines} truncated={diff.truncated} />
        )}
      </div>
    </Modal>
  );
}
