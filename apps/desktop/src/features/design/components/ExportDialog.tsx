import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import { saveBlobToFile } from '../../../services/fileDownload';
import { exportDesignZip, isDesignHttpError } from '../api';
import type { DesignExportRequest } from '../types';

const CONFLICT_NOTICE = 'The file has changed; refreshing.';
const SAVE_FAILED_NOTICE = 'Save failed, so the export was stopped; resolve the save problem and try again.';
const INCOMPLETE_RETRY_LABEL = 'Export anyway (the manifest will note missing files)';

/** 一次导出请求中除 confirmIncomplete 外的参数（重试时复用）。 */
type ExportBase =
  | { mode: 'disk'; expectedRevision?: string }
  | { mode: 'draft'; draftSource: string };

type Stage =
  /** dirty 页等待三选（保存并导出 / 导出草稿 / 取消）。 */
  | { kind: 'choose' }
  /** 进行中：按钮禁用 + 状态文案。from 区分三选发起与干净页直通。 */
  | { kind: 'working'; label: string; from: 'choose' | 'direct' }
  /** EXPORT_INCOMPLETE：列出缺失清单，可 confirmIncomplete 重试。 */
  | { kind: 'incomplete'; files: string[] }
  /** REVISION_CONFLICT：提示并已触发一次面板刷新。 */
  | { kind: 'conflict' }
  /** 成功：blob 已完整生成并保存。 */
  | { kind: 'done'; filename: string }
  /** 其余错误（含保存失败）。保存失败不可「重试导出」。 */
  | { kind: 'error'; message: string; retryable: boolean };

export interface ExportDialogProps {
  open: boolean;
  backendId: string;
  sessionId: string;
  /** 入口 HTML 工作区相对路径（活动页）。 */
  path: string;
  /** 活动页 dirty：打开时三选；干净页直接以 disk 模式导出。 */
  dirty: boolean;
  /** 干净页 disk 模式的版本钉（活动页 docRevision）。 */
  expectedRevision: string | null;
  /** dirty 页「导出草稿」的草稿全文。 */
  draftSource: string;
  /** 「保存并导出」先走面板保存（controller.save）；成功返回保存后的磁盘修订，失败返回 null。 */
  onSave: () => Promise<string | null>;
  /** REVISION_CONFLICT 时触发一次面板立即刷新。 */
  onRefresh: () => void;
  onClose: () => void;
}

/**
 * 导出对话框（P2 §6.4 四步）：dirty 三选 → exportDesignZip → 错误分流
 * （EXPORT_INCOMPLETE 缺失清单 + 确认重试 / REVISION_CONFLICT 提示并刷新 /
 * 其余显示 message）→ saveBlobToFile 落盘。buffer 完整生成后才保存，
 * 任何失败路径都不落盘半成品。
 */
export function ExportDialog({
  open,
  backendId,
  sessionId,
  path,
  dirty,
  expectedRevision,
  draftSource,
  onSave,
  onRefresh,
  onClose,
}: ExportDialogProps) {
  const [stage, setStage] = useState<Stage>(() =>
    dirty ? { kind: 'choose' } : { kind: 'working', label: 'Exporting…', from: 'direct' }
  );
  const baseRef = useRef<ExportBase | null>(null);
  const startedRef = useRef(false);
  /** 当前导出流程的发起上下文（干净页直通 vs dirty 三选），重试时沿用。 */
  const fromRef = useRef<'choose' | 'direct'>('choose');
  // 面板刷新后 props 会更新；流程内读 ref 以拿到最新 dirty/expectedRevision。
  const freshRef = useRef({ dirty, expectedRevision });
  useEffect(() => {
    freshRef.current = { dirty, expectedRevision };
  }, [dirty, expectedRevision]);

  const runExport = useCallback(
    async (
      base: ExportBase,
      options?: { confirmIncomplete?: boolean; from?: 'choose' | 'direct' }
    ) => {
      baseRef.current = base;
      if (options?.from) fromRef.current = options.from;
      setStage({
        kind: 'working',
        label: base.mode === 'draft' ? 'Exporting draft…' : 'Exporting…',
        from: fromRef.current,
      });
      const request: DesignExportRequest = {
        sessionId,
        path,
        ...base,
        ...(options?.confirmIncomplete ? { confirmIncomplete: true } : {}),
      };
      try {
        const { blob, filename } = await exportDesignZip(backendId, request);
        await saveBlobToFile(blob, filename);
        setStage({ kind: 'done', filename });
      } catch (error) {
        if (isDesignHttpError(error) && error.code === 'EXPORT_INCOMPLETE') {
          setStage({ kind: 'incomplete', files: error.files });
        } else if (isDesignHttpError(error) && error.code === 'REVISION_CONFLICT') {
          onRefresh();
          setStage({ kind: 'conflict' });
        } else {
          setStage({
            kind: 'error',
            message: error instanceof Error ? error.message : String(error),
            retryable: true,
          });
        }
      }
    },
    [backendId, onRefresh, path, sessionId]
  );

  // 打开即启动：干净页直接 disk 导出（expectedRevision = 活动页 docRevision）；
  // dirty 页等用户三选。关闭时重置，下次打开重新开始。
  useEffect(() => {
    if (!open) {
      startedRef.current = false;
      baseRef.current = null;
      setStage({ kind: 'choose' });
      return;
    }
    if (startedRef.current || freshRef.current.dirty) return;
    startedRef.current = true;
    void runExport(
      { mode: 'disk', expectedRevision: freshRef.current.expectedRevision ?? undefined },
      { from: 'direct' }
    );
  }, [open, runExport]);

  /** 保存并导出：先 controller.save（面板包装），成功后以新磁盘修订走 disk 导出。 */
  const saveThenExport = () => {
    setStage({ kind: 'working', label: 'Saving…', from: 'choose' });
    void (async () => {
      const revision = await onSave();
      if (revision === null) {
        // 保存失败：停留并显示错误，不发起导出。
        setStage({ kind: 'error', message: SAVE_FAILED_NOTICE, retryable: false });
        return;
      }
      await runExport({ mode: 'disk', expectedRevision: revision });
    })();
  };

  const retry = () => {
    const base = baseRef.current;
    if (!base) return;
    void runExport(
      base.mode === 'disk'
        ? // 磁盘可能已刷新：用最新 docRevision 重钉。
          { mode: 'disk', expectedRevision: freshRef.current.expectedRevision ?? base.expectedRevision }
        : base
    );
  };

  const retryConfirmingIncomplete = () => {
    if (!baseRef.current) return;
    void runExport(baseRef.current, { confirmIncomplete: true });
  };

  const working = stage.kind === 'working';
  return (
    <Modal
      open={open}
      onClose={onClose}
      ariaLabel="Export"
      title="Export"
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          {stage.kind === 'incomplete' ? (
            <>
              <Button size="sm" onClick={retryConfirmingIncomplete}>
                {INCOMPLETE_RETRY_LABEL}
              </Button>
              <Button size="sm" onClick={onClose}>
                Cancel
              </Button>
            </>
          ) : stage.kind === 'choose' || (working && stage.from === 'choose') ? (
            <>
              <Button
                size="sm"
                variant="primary"
                onClick={saveThenExport}
                disabled={working}
                aria-label="Save and export"
              >
                Save and export
              </Button>
              <Button size="sm" onClick={() => void runExport({ mode: 'draft', draftSource })} disabled={working}>
                Export draft
              </Button>
              <Button size="sm" onClick={onClose} disabled={working}>
                Cancel
              </Button>
            </>
          ) : stage.kind === 'error' && stage.retryable ? (
            <>
              <Button size="sm" onClick={retry}>
                Retry
              </Button>
              <Button size="sm" onClick={onClose}>
                Close
              </Button>
            </>
          ) : stage.kind === 'conflict' ? (
            <>
              <Button size="sm" onClick={retry}>
                Retry
              </Button>
              <Button size="sm" onClick={onClose}>
                Close
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={onClose} disabled={working}>
              Close
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-3 p-4 text-xs">
        {stage.kind === 'choose' && (
          <div className="text-muted-foreground">
            "{path}" has unsaved changes; choose how to export.
          </div>
        )}
        {stage.kind === 'working' && (
          <div role="status" className="text-muted-foreground">
            {stage.label}
          </div>
        )}
        {stage.kind === 'incomplete' && (
          <>
            <div className="text-warning">The following referenced assets are missing from the workspace; the export was refused by default:</div>
            <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border border-border px-2 py-1.5">
              {stage.files.map(file => (
                <li key={file} className="font-mono text-[11px]">
                  {file}
                </li>
              ))}
            </ul>
            {stage.files.length === 0 && (
              <div className="text-muted-foreground">The server did not return a missing-asset list.</div>
            )}
          </>
        )}
        {stage.kind === 'conflict' && (
          <div role="status" className="text-warning">
            {CONFLICT_NOTICE}
          </div>
        )}
        {stage.kind === 'done' && (
          <div role="status" className="text-success">
            Exported: {stage.filename}
          </div>
        )}
        {stage.kind === 'error' && (
          <div role="alert" className="text-destructive">
            {stage.message}
          </div>
        )}
      </div>
    </Modal>
  );
}
