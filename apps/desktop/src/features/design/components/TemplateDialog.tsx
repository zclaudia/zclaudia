import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import {
  isDesignHttpError,
  installDesignTemplate,
  listDesignTemplates,
} from '../api';
import type { DesignTemplateSummary } from '../api';

const LOADING_LABEL = 'Loading templates…';
const EMPTY_LABEL = 'No built-in templates.';
const CONFLICT_TITLE = 'These files already exist:';
const CONFLICT_HINT = 'Reinstalling will replace the files above.';
const OVERWRITE_LABEL = 'Reinstall and overwrite the files above';
const INSTALL_DONE_LABEL = 'Installation finished; the following files were written:';
const OPEN_PAGE_LABEL = 'Open page';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface TemplateDialogProps {
  open: boolean;
  backendId: string;
  sessionId: string;
  onClose: () => void;
  /** 安装成功后由用户点击「打开页面」触发；payload 为模板入口路径。 */
  onInstalled: (entry: string) => void;
}

/**
 * 内置模板对话框（P4 §2.4）：打开拉取目录 → 每项可安装；成功显示已写入
 * 文件与入口（「打开页面」上抛 entry）；409 TEMPLATE_TARGET_EXISTS 列出
 * 冲突路径，经「覆盖以上文件重新安装」显式确认后带 overwrite 重试；其余
 * 错误显示 message 并可重试。状态全部由 props 驱动，不自持工作区。
 */
export function TemplateDialog({
  open,
  backendId,
  sessionId,
  onClose,
  onInstalled,
}: TemplateDialogProps) {
  const [templates, setTemplates] = useState<DesignTemplateSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 正在安装的模板 id；非空时所有安装按钮禁用，该项显示「安装中…」。 */
  const [installingId, setInstallingId] = useState<string | null>(null);
  /** 409 冲突：记录模板 id 与服务端返回的冲突路径。 */
  const [conflict, setConflict] = useState<{ templateId: string; files: string[] } | null>(null);
  const [installError, setInstallError] = useState<{ templateId: string; message: string } | null>(
    null
  );
  const [result, setResult] = useState<{ installed: string[]; entry: string } | null>(null);

  const load = useCallback(() => {
    setTemplates(null);
    setLoadError(null);
    listDesignTemplates(backendId)
      .then(list => setTemplates(list.templates))
      .catch(error => setLoadError(errorText(error)));
  }, [backendId]);

  // 打开时拉取目录；关闭即清空，下次 false→true 重新拉取。
  useEffect(() => {
    if (open) {
      load();
    } else {
      setTemplates(null);
      setLoadError(null);
      setInstallingId(null);
      setConflict(null);
      setInstallError(null);
      setResult(null);
    }
  }, [open, load]);

  const install = useCallback(
    (templateId: string, overwrite?: boolean) => {
      setInstallingId(templateId);
      setConflict(null);
      setInstallError(null);
      installDesignTemplate(
        backendId,
        overwrite ? { sessionId, templateId, overwrite: true } : { sessionId, templateId }
      )
        .then(installed => {
          setInstallingId(null);
          setResult({ installed: installed.installed, entry: installed.entry });
        })
        .catch(error => {
          setInstallingId(null);
          if (isDesignHttpError(error) && error.code === 'TEMPLATE_TARGET_EXISTS') {
            setConflict({ templateId, files: error.files });
          } else {
            setInstallError({ templateId, message: errorText(error) });
          }
        });
    },
    [backendId, sessionId]
  );

  const busy = installingId !== null;

  const renderTemplateItem = (template: DesignTemplateSummary) => {
    const installing = installingId === template.id;
    return (
      <li
        key={template.id}
        className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2"
      >
        <div className="min-w-0 flex flex-col gap-0.5">
          <span className="text-[13px] font-medium text-foreground">{template.name}</span>
          <span className="text-[11px] text-muted-foreground">{template.description}</span>
          <span className="truncate font-mono text-[11px] text-muted-foreground">
            {template.entry}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {template.files.length} files · v{template.version}
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          disabled={busy}
          aria-label={`Install ${template.name}`}
          onClick={() => install(template.id)}
        >
          {installing ? 'Installing…' : 'Install'}
        </Button>
      </li>
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      ariaLabel="Templates"
      title="Templates"
      size="lg"
      footer={
        result ? (
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="primary" onClick={() => onInstalled(result.entry)}>
              {OPEN_PAGE_LABEL}
            </Button>
            <Button size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        ) : (
          <div className="flex justify-end">
            <Button size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        )
      }
    >
      <div className="flex flex-col gap-3 p-4 text-xs">
        {loadError !== null && (
          <div className="flex items-center justify-between gap-2">
            <span role="alert" className="text-destructive">
              {loadError}
            </span>
            <Button size="sm" onClick={load}>
              Retry
            </Button>
          </div>
        )}
        {templates === null && loadError === null && (
          <div role="status" className="text-muted-foreground">
            {LOADING_LABEL}
          </div>
        )}
        {result !== null && (
          <div className="flex flex-col gap-2">
            <div role="status" className="text-success">
              {INSTALL_DONE_LABEL}
            </div>
            <ul
              data-testid="installed-files"
              className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border border-border px-2 py-1.5"
            >
              {result.installed.map(file => (
                <li key={file} className="font-mono text-[11px]">
                  {file}
                </li>
              ))}
            </ul>
            <div className="text-muted-foreground">
              Entry: <span className="font-mono text-[11px]">{result.entry}</span>
            </div>
          </div>
        )}
        {result === null && templates !== null && (
          <>
            {conflict !== null && (
              <div role="alert" className="flex flex-col gap-1.5 rounded-md border border-border px-3 py-2">
                <span className="text-warning">{CONFLICT_TITLE}</span>
                <ul className="flex max-h-32 flex-col gap-0.5 overflow-y-auto">
                  {conflict.files.map(file => (
                    <li key={file} className="font-mono text-[11px]">
                      {file}
                    </li>
                  ))}
                </ul>
                <span className="text-muted-foreground">{CONFLICT_HINT}</span>
                <div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => install(conflict.templateId, true)}
                  >
                    {OVERWRITE_LABEL}
                  </Button>
                </div>
              </div>
            )}
            {installError !== null && (
              <div className="flex items-center justify-between gap-2">
                <span role="alert" className="text-destructive">
                  {installError.message}
                </span>
                <Button size="sm" disabled={busy} onClick={() => install(installError.templateId)}>
                  Retry
                </Button>
              </div>
            )}
            {templates.length === 0 ? (
              <div role="status" className="text-muted-foreground">
                {EMPTY_LABEL}
              </div>
            ) : (
              <ul className="flex flex-col gap-2">{templates.map(renderTemplateItem)}</ul>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
