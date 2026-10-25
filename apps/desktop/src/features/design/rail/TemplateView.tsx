import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../../components/ui/Button';
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

export interface TemplateViewProps {
  /** Load while visible; hide/reset when the rail or Library tab is closed. */
  active: boolean;
  backendId: string;
  sessionId: string;
  /** Compact rows for the left rail; the modal shell keeps the original layout. */
  compact?: boolean;
  /** Embedded mode opens the entry immediately after a successful install. */
  openEntryOnInstall?: boolean;
  onInstalled: (entry: string) => void;
}

/** Shared template browser for the left rail and the TemplateDialog shell. */
export function TemplateView({
  active,
  backendId,
  sessionId,
  compact = false,
  openEntryOnInstall = false,
  onInstalled,
}: TemplateViewProps) {
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

  // 可见时拉取目录；隐藏即清空，下次重新可见时重新拉取。
  useEffect(() => {
    if (active) {
      load();
    } else {
      setTemplates(null);
      setLoadError(null);
      setInstallingId(null);
      setConflict(null);
      setInstallError(null);
      setResult(null);
    }
  }, [active, load]);

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
          if (openEntryOnInstall) onInstalled(installed.entry);
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
    [backendId, sessionId, openEntryOnInstall, onInstalled]
  );

  const busy = installingId !== null;

  const renderTemplateItem = (template: DesignTemplateSummary) => {
    const installing = installingId === template.id;
    return (
      <li
        key={template.id}
        className={`flex gap-3 rounded-md border border-border ${
          compact
            ? 'flex-col px-2.5 py-2'
            : 'items-start justify-between px-3 py-2'
        }`}
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
          className={compact ? 'self-end' : 'shrink-0'}
          disabled={busy}
          aria-label={`Install ${template.name}`}
          onClick={() => install(template.id)}
        >
          {installing ? 'Installing…' : 'Install'}
        </Button>
      </li>
    );
  };

  if (!active) return null;

  return (
    <div className={`flex flex-col text-xs ${compact ? 'gap-2' : 'gap-3 p-4'}`}>
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
          {!openEntryOnInstall && (
            <div className="flex justify-end">
              <Button size="sm" variant="primary" onClick={() => onInstalled(result.entry)}>
                {OPEN_PAGE_LABEL}
              </Button>
            </div>
          )}
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
                  className={compact ? 'h-auto whitespace-normal text-left' : undefined}
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
  );
}
