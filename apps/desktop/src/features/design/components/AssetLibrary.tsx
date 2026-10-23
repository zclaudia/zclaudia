import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import { getDesignAsset, importDesignAsset, listDesignAssets } from '../api';
import { relativeAssetRef } from '../asset-ref';
import type { DesignEditOperation } from '../types';
import { readFileAsBase64 } from '../../../services/fileUpload';

const THUMBNAIL_LIMIT = 50;
const TRUNCATED_LABEL = '…（仅显示前 50 项）';
const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.gif,.webp,.svg,.ico,.avif';
const FONT_ACCEPT = '.woff,.woff2,.ttf,.otf';
const LOADING_LABEL = '正在加载素材…';
const EMPTY_LABEL = '工作区暂无素材';
const IMPORTING_LABEL = '正在导入素材…';
const REPLACE_NEEDS_IMG = '需要先在预览中选中一个图片元素';
const REPLACE_NEEDS_DOC = '当前没有活动页面';
const VIDEO_IMPORT_HINT = '视频由媒体生成任务产生，不支持导入';
const VIDEO_SIZE_UNKNOWN = '体积未知';

type Tab = 'image' | 'font' | 'video';

interface ImportNotice {
  kind: 'info' | 'error';
  text: string;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function baseName(path: string): string {
  return path.split('/').pop() ?? path;
}

function base64ByteLength(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 被引用判定（P4 §4.2）：素材工作区路径 ∈ referencedAssets，或换算到任一
 * 打开页目录的相对引用出现在该页草稿源码中。
 */
function isReferenced(
  assetPath: string,
  openPages: { path: string; source: string }[],
  referencedAssets: string[]
): boolean {
  if (referencedAssets.includes(assetPath)) return true;
  return openPages.some(page => page.source.includes(relativeAssetRef(page.path, assetPath)));
}

export interface AssetLibraryProps {
  open: boolean;
  backendId: string;
  sessionId: string;
  /** 打开页草稿源码（被引用判定用）。 */
  openPages: { path: string; source: string }[];
  /** 活动页依赖的素材路径（被引用判定用）。 */
  referencedAssets: string[];
  activeDocPath: string | null;
  /** 预览选区（仅 tagName 参与判断）。 */
  selection: { tagName: string } | null;
  /** 「替换选中图片」上抛的编辑事务（面板接既有 handleApply）。 */
  onApply: (operations: DesignEditOperation[]) => void;
  /** 单个素材导入成功后的工作区相对路径。 */
  onImported: (path: string) => void;
  onClose: () => void;
}

/**
 * 素材库（P4 §4.2）：图片/字体/视频三个 tab（各自拉清单）；图片项直接加载缩略图
 * （≤50 项，超出截断提示）；「导入」逐个 readFileAsBase64 → importDesignAsset，
 * 重名去重改名有提示、单个失败不中断其余；图片项可把选中 <img> 的 src 替换为
 * 素材相对引用（保持弹窗打开）。视频项（P6 §5.3）仅列清单与体积（经 asset 接口
 * 的 base64 长度换算，≤10 MiB 可读，超限显示「体积未知」），无缩略图、不可导入、
 * 不可替换。
 */
export function AssetLibrary({
  open,
  backendId,
  sessionId,
  openPages,
  referencedAssets,
  activeDocPath,
  selection,
  onApply,
  onImported,
  onClose,
}: AssetLibraryProps) {
  const [tab, setTab] = useState<Tab>('image');
  const [files, setFiles] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [sizes, setSizes] = useState<Record<string, string>>({});
  const [notices, setNotices] = useState<ImportNotice[]>([]);
  const [importing, setImporting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setFiles(null);
    setLoadError(null);
    setThumbs({});
    setSizes({});
    listDesignAssets(backendId, sessionId, tab)
      .then(list => setFiles(list.files))
      .catch(error => setLoadError(errorText(error)));
  }, [backendId, sessionId, tab]);

  // 打开或切 tab 时拉取清单；关闭即全部复位。
  useEffect(() => {
    if (open) {
      load();
    } else {
      setTab('image');
      setFiles(null);
      setLoadError(null);
      setThumbs({});
      setSizes({});
      setNotices([]);
      setImporting(false);
    }
  }, [open, load]);

  // 图片缩略图：直接加载渲染中的前 50 项；失败静默留占位。
  useEffect(() => {
    if (files === null || tab !== 'image') return;
    let cancelled = false;
    for (const path of files.slice(0, THUMBNAIL_LIMIT)) {
      getDesignAsset(backendId, sessionId, path)
        .then(asset => {
          if (cancelled) return;
          const url = `data:${asset.mimeType};base64,${asset.data}`;
          setThumbs(prev => ({ ...prev, [path]: url }));
        })
        .catch(() => {
          // 无缩略图时保留占位块
        });
    }
    return () => {
      cancelled = true;
    };
  }, [files, tab, backendId, sessionId]);

  // 视频体积：asset 接口 base64 长度换算（≤10 MiB 可读）；超限等失败标「体积未知」。
  useEffect(() => {
    if (files === null || tab !== 'video') return;
    let cancelled = false;
    for (const path of files.slice(0, THUMBNAIL_LIMIT)) {
      getDesignAsset(backendId, sessionId, path)
        .then(asset => {
          if (cancelled) return;
          setSizes(prev => ({ ...prev, [path]: formatBytes(base64ByteLength(asset.data)) }));
        })
        .catch(() => {
          if (cancelled) return;
          setSizes(prev => ({ ...prev, [path]: VIDEO_SIZE_UNKNOWN }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [files, tab, backendId, sessionId]);

  const handleImport = async (fileList: FileList | null) => {
    const picked = Array.from(fileList ?? []);
    if (picked.length === 0) return;
    setImporting(true);
    for (const file of picked) {
      try {
        const dataBase64 = await readFileAsBase64(file);
        const { path } = await importDesignAsset(backendId, {
          sessionId,
          fileName: file.name,
          dataBase64,
        });
        const savedName = baseName(path);
        if (savedName !== file.name) {
          setNotices(prev => [...prev, { kind: 'info', text: `${file.name} 已保存为 ${savedName}` }]);
        }
        onImported(path);
      } catch (error) {
        setNotices(prev => [
          ...prev,
          { kind: 'error', text: `${file.name} 导入失败：${errorText(error)}` },
        ]);
      }
    }
    setImporting(false);
    load();
  };

  const onInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    void handleImport(event.target.files);
    // 清空让同一文件可再次选择
    event.target.value = '';
  };

  const pickFiles = () => inputRef.current?.click();

  const canReplace = selection?.tagName === 'img' && activeDocPath !== null;
  const replaceTitle = canReplace
    ? '把选中图片的 src 替换为该素材的相对引用'
    : selection?.tagName !== 'img'
      ? REPLACE_NEEDS_IMG
      : REPLACE_NEEDS_DOC;

  const visible = files === null ? [] : files.slice(0, THUMBNAIL_LIMIT);

  return (
    <Modal
      open={open}
      onClose={onClose}
      ariaLabel="素材库"
      title="素材库"
      size="2xl"
      footer={
        <div className="flex justify-end">
          <Button size="sm" onClick={onClose}>
            关闭
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 p-4 text-xs">
        <div className="flex items-center justify-between gap-2">
          <div className="flex w-fit gap-0.5 rounded-md bg-secondary p-0.5" role="tablist" aria-label="素材类型">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'image'}
              className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
                tab === 'image'
                  ? 'bg-card text-foreground shadow-apple-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setTab('image')}
            >
              图片
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'font'}
              className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
                tab === 'font'
                  ? 'bg-card text-foreground shadow-apple-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setTab('font')}
            >
              字体
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'video'}
              className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
                tab === 'video'
                  ? 'bg-card text-foreground shadow-apple-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setTab('video')}
            >
              视频
            </button>
          </div>
          {tab === 'video' ? (
            <span className="text-[11px] text-muted-foreground">{VIDEO_IMPORT_HINT}</span>
          ) : (
            <>
              <Button size="sm" variant="outline" disabled={importing} onClick={pickFiles}>
                {importing ? '导入中…' : '导入'}
              </Button>
              <input
                ref={inputRef}
                type="file"
                hidden
                multiple
                accept={tab === 'image' ? IMAGE_ACCEPT : FONT_ACCEPT}
                aria-label="选择要导入的素材文件"
                onChange={onInputChange}
              />
            </>
          )}
        </div>
        {notices.map((notice, index) => (
          <div
            key={`${notice.kind}-${index}`}
            role={notice.kind === 'error' ? 'alert' : 'status'}
            className={notice.kind === 'error' ? 'text-destructive' : 'text-muted-foreground'}
          >
            {notice.text}
          </div>
        ))}
        {importing && (
          <div role="status" className="text-muted-foreground">
            {IMPORTING_LABEL}
          </div>
        )}
        {loadError !== null && (
          <div className="flex items-center justify-between gap-2">
            <span role="alert" className="text-destructive">
              {loadError}
            </span>
            <Button size="sm" onClick={load}>
              重试
            </Button>
          </div>
        )}
        {files === null && loadError === null && (
          <div role="status" className="text-muted-foreground">
            {LOADING_LABEL}
          </div>
        )}
        {files !== null && files.length === 0 && (
          <div role="status" className="text-muted-foreground">
            {EMPTY_LABEL}
          </div>
        )}
        {files !== null && files.length > 0 && (
          <ul className="flex flex-col gap-2">
            {visible.map(file => (
              <li
                key={file}
                className="flex items-center gap-3 rounded-md border border-border px-3 py-2"
              >
                {tab === 'image' ? (
                  thumbs[file] !== undefined ? (
                    <img
                      src={thumbs[file]}
                      alt=""
                      className="h-10 w-10 shrink-0 rounded-md border border-border object-cover"
                    />
                  ) : (
                    <span aria-hidden className="h-10 w-10 shrink-0 rounded-md border border-border bg-secondary" />
                  )
                ) : (
                  <span
                    aria-hidden
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-secondary text-[10px] text-muted-foreground"
                  >
                    {file.includes('.') ? file.slice(file.lastIndexOf('.') + 1).toUpperCase() : '?'}
                  </span>
                )}
                <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                  <span className="max-w-full truncate font-mono text-[11px] text-foreground">
                    {file}
                  </span>
                  {tab === 'font' && (
                    <span className="text-[11px] text-muted-foreground">字体不支持预览</span>
                  )}
                  {tab === 'video' && (
                    <span className="text-[11px] text-muted-foreground">
                      {sizes[file] ?? '…'}
                    </span>
                  )}
                  {isReferenced(file, openPages, referencedAssets) && (
                    <span className="rounded-full border border-border bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      已引用
                    </span>
                  )}
                </div>
                {tab === 'image' && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    disabled={!canReplace}
                    title={replaceTitle}
                    aria-label={`替换选中图片 ${baseName(file)}`}
                    onClick={() =>
                      onApply([
                        {
                          kind: 'attribute',
                          name: 'src',
                          value: relativeAssetRef(activeDocPath ?? '', file),
                        },
                      ])
                    }
                  >
                    替换选中图片
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {files !== null && files.length > THUMBNAIL_LIMIT && (
          <div className="text-muted-foreground">{TRUNCATED_LABEL}</div>
        )}
      </div>
    </Modal>
  );
}
