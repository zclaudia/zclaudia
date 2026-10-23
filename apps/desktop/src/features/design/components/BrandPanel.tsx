import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import { FIELD_CLASS, Input } from '../../../components/ui/Input';
import {
  getDesignBrand,
  isDesignHttpError,
  listDesignAssets,
  putDesignBrand,
} from '../api';
import type { DesignBrand } from '../api';
import { relativeAssetRef } from '../asset-ref';
import { renderDesignMd, renderTokensCss, validateBrandSpec } from '../brand';
import type { BrandSpec } from '../brand';

const FORM_HINT = '生成 design/DESIGN.md 与 design/tokens.css 两个品牌文件；Agent 修改页面时会读取它们。';
const TEXT_HINT = '直接编辑品牌文件；保存前会校验文件未被外部修改。';
const LOADING_LABEL = '正在加载品牌文件…';
const CREATE_DONE_LABEL = '品牌文件已创建：design/DESIGN.md、design/tokens.css';
const SAVED_LABEL = '已保存';
const CONFLICT_LABEL = '文件已在其他位置更新，请重新加载';
const ASSET_EMPTY = '工作区暂无素材';
const ASSET_LOAD_ERROR = '素材清单加载失败';

/** 与 brand.ts 的颜色语法同口径，仅用于色块预览（真校验走 validateBrandSpec）。 */
const COLOR_PREVIEW =
  /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$|^(?:rgb|rgba|hsl|hsla)\([\d.%\s,+/-]+\)$|^[a-zA-Z]{3,32}$/;

const DEFAULT_SPEC: BrandSpec = {
  primary: '#4f46e5',
  secondary: '#64748b',
  background: '#ffffff',
  text: '#0f172a',
  fontBody: 'system-ui, sans-serif',
  fontHeading: 'system-ui, sans-serif',
  spacingUnit: '8px',
  radius: 'md',
  logoPath: '',
  notes: '',
};

const COLOR_FIELDS: { key: 'primary' | 'secondary' | 'background' | 'text'; label: string }[] = [
  { key: 'primary', label: '主色' },
  { key: 'secondary', label: '辅色' },
  { key: 'background', label: '背景' },
  { key: 'text', label: '文字' },
];

const RADIUS_OPTIONS: { value: BrandSpec['radius']; label: string }[] = [
  { value: 'none', label: '无' },
  { value: 'sm', label: '小 4px' },
  { value: 'md', label: '中 8px' },
  { value: 'lg', label: '大 16px' },
];

type AssetPanelState = 'closed' | 'loading' | 'ready' | 'error';

interface FileSaveState {
  status: 'idle' | 'saving' | 'saved';
  conflict: boolean;
  error: string | null;
}

const IDLE_SAVE: FileSaveState = { status: 'idle', conflict: false, error: null };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface BrandPanelProps {
  open: boolean;
  backendId: string;
  sessionId: string;
  onClose: () => void;
  /** 任一品牌文件保存成功后触发（面板刷新品牌缓存）。 */
  onSaved: () => void;
}

/**
 * 品牌面板（P4 §3.4）：打开时 GET /api/design/brand。两文件都缺失 → 表单
 * 生成模式（本地 validateBrandSpec 预检 → renderDesignMd/renderTokensCss →
 * PUT，修订传 '' 创建）；任一存在 → 文本编辑模式（逐文件保存，带 GET 修订；
 * REVISION_CONFLICT 提示重新加载）。不做表单回读。
 */
export function BrandPanel({ open, backendId, sessionId, onClose, onSaved }: BrandPanelProps) {
  const [brand, setBrand] = useState<DesignBrand | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<BrandSpec>(DEFAULT_SPEC);
  const [validationErrors, setValidationErrors] = useState<string[] | null>(null);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSaved, setFormSaved] = useState(false);
  const [designMdText, setDesignMdText] = useState('');
  const [tokensCssText, setTokensCssText] = useState('');
  const [mdSave, setMdSave] = useState<FileSaveState>(IDLE_SAVE);
  const [cssSave, setCssSave] = useState<FileSaveState>(IDLE_SAVE);
  const [assetPanel, setAssetPanel] = useState<AssetPanelState>('closed');
  const [assetFiles, setAssetFiles] = useState<string[]>([]);

  const load = useCallback(() => {
    setLoadError(null);
    getDesignBrand(backendId, sessionId)
      .then(next => {
        setBrand(next);
        setDesignMdText(next.designMd ?? '');
        setTokensCssText(next.tokensCss ?? '');
        setMdSave(IDLE_SAVE);
        setCssSave(IDLE_SAVE);
      })
      .catch(error => setLoadError(errorText(error)));
  }, [backendId, sessionId]);

  // 打开时拉取品牌文件；关闭即全部复位，下次 false→true 重新拉取。
  useEffect(() => {
    if (open) {
      setBrand(null);
      setLoadError(null);
      setForm(DEFAULT_SPEC);
      setValidationErrors(null);
      setFormSaving(false);
      setFormError(null);
      setFormSaved(false);
      setDesignMdText('');
      setTokensCssText('');
      setMdSave(IDLE_SAVE);
      setCssSave(IDLE_SAVE);
      setAssetPanel('closed');
      setAssetFiles([]);
      load();
    }
  }, [open, load]);

  const submitForm = () => {
    const errors = validateBrandSpec(form);
    setValidationErrors(errors.length > 0 ? errors : null);
    if (errors.length > 0) return;
    setFormSaving(true);
    setFormError(null);
    putDesignBrand(backendId, {
      sessionId,
      designMd: renderDesignMd(form),
      designMdRevision: '',
      tokensCss: renderTokensCss(form),
      tokensCssRevision: '',
    })
      .then(() => {
        setFormSaving(false);
        setFormSaved(true);
        onSaved();
      })
      .catch(error => {
        setFormSaving(false);
        setFormError(errorText(error));
      });
  };

  /** 文本模式逐文件保存：只提交该文件的键，修订取 GET 返回（缺失文件为 ''）。 */
  const saveFile = (file: 'designMd' | 'tokensCss') => {
    if (brand === null) return;
    const setter = file === 'designMd' ? setMdSave : setCssSave;
    const text = file === 'designMd' ? designMdText : tokensCssText;
    const revision = (file === 'designMd' ? brand.designMdRevision : brand.tokensCssRevision) ?? '';
    setter({ status: 'saving', conflict: false, error: null });
    const input =
      file === 'designMd'
        ? { sessionId, designMd: text, designMdRevision: revision }
        : { sessionId, tokensCss: text, tokensCssRevision: revision };
    putDesignBrand(backendId, input)
      .then(result => {
        const revisions = (result ?? {}) as {
          designMdRevision?: string | null;
          tokensCssRevision?: string | null;
        };
        const fresh =
          file === 'designMd' ? revisions.designMdRevision : revisions.tokensCssRevision;
        if (fresh != null) {
          setBrand(prev =>
            prev
              ? file === 'designMd'
                ? { ...prev, designMdRevision: fresh }
                : { ...prev, tokensCssRevision: fresh }
              : prev
          );
        }
        setter({ status: 'saved', conflict: false, error: null });
        onSaved();
      })
      .catch(error => {
        if (isDesignHttpError(error) && error.code === 'REVISION_CONFLICT') {
          setter({ status: 'idle', conflict: true, error: null });
        } else {
          setter({ status: 'idle', conflict: false, error: errorText(error) });
        }
      });
  };

  const loadAssets = useCallback(() => {
    setAssetPanel('loading');
    setAssetFiles([]);
    listDesignAssets(backendId, sessionId, 'all')
      .then(list => {
        setAssetFiles(list.files);
        setAssetPanel('ready');
      })
      .catch(() => setAssetPanel('error'));
  }, [backendId, sessionId]);

  const toggleAssets = () => {
    if (assetPanel !== 'closed') {
      setAssetPanel('closed');
      return;
    }
    loadAssets();
  };

  /** 选中素材：以 design/ 目录为基准换算相对引用（docPath 取 design/index.html）。 */
  const chooseAsset = (file: string) => {
    setForm(prev => ({ ...prev, logoPath: relativeAssetRef('design/index.html', file) }));
    setAssetPanel('closed');
  };

  const loading = brand === null && loadError === null;
  const textMode = brand !== null && (brand.designMd !== null || brand.tokensCss !== null);

  const renderSaveState = (state: FileSaveState, fileLabel: string) => (
    <>
      {state.status === 'saving' && (
        <div role="status" className="text-muted-foreground">
          保存中…
        </div>
      )}
      {state.status === 'saved' && (
        <div role="status" className="text-success">
          {SAVED_LABEL}
        </div>
      )}
      {state.conflict && (
        <div className="flex items-center gap-2">
          <span role="alert" className="text-warning">
            {CONFLICT_LABEL}
          </span>
          <Button size="sm" aria-label={`重新加载 ${fileLabel}`} onClick={load}>
            重新加载
          </Button>
        </div>
      )}
      {state.error !== null && (
        <div role="alert" className="text-destructive">
          {state.error}
        </div>
      )}
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      ariaLabel="品牌"
      title="品牌"
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          {!textMode && brand !== null && (
            <Button size="sm" variant="primary" disabled={formSaving} onClick={submitForm}>
              生成品牌文件
            </Button>
          )}
          <Button size="sm" onClick={onClose}>
            关闭
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 p-4 text-xs">
        {loading && (
          <div role="status" className="text-muted-foreground">
            {LOADING_LABEL}
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
        {brand !== null && !textMode && (
          <>
            <div className="text-muted-foreground">{FORM_HINT}</div>
            {validationErrors !== null && (
              <div
                role="alert"
                className="flex flex-col gap-0.5 rounded-md border border-border px-3 py-2 text-destructive"
              >
                {validationErrors.map(error => (
                  <div key={error}>{error}</div>
                ))}
              </div>
            )}
            {formSaved && (
              <div role="status" className="text-success">
                {CREATE_DONE_LABEL}
              </div>
            )}
            {formError !== null && (
              <div role="alert" className="text-destructive">
                {formError}
              </div>
            )}
            {COLOR_FIELDS.map(({ key, label }) => {
              const value = form[key];
              const trimmed = value.trim();
              const showSwatch = trimmed !== '' && COLOR_PREVIEW.test(trimmed);
              return (
                <div key={key} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-2">
                  <label htmlFor={`brand-${key}`} className="text-muted-foreground">
                    {label}
                  </label>
                  <Input
                    id={`brand-${key}`}
                    value={value}
                    onChange={event =>
                      setForm(prev => ({ ...prev, [key]: event.target.value }))
                    }
                  />
                  {showSwatch ? (
                    <span
                      data-testid={`swatch-${key}`}
                      aria-hidden
                      className="h-6 w-6 shrink-0 rounded-md border border-border"
                      style={{ backgroundColor: trimmed }}
                    />
                  ) : (
                    <span aria-hidden className="h-6 w-6 shrink-0" />
                  )}
                </div>
              );
            })}
            {(['fontBody', 'fontHeading'] as const).map(key => (
              <div key={key} className="grid grid-cols-[4.5rem_1fr] items-center gap-2">
                <label htmlFor={`brand-${key}`} className="text-muted-foreground">
                  {key === 'fontBody' ? '正文字体' : '标题字体'}
                </label>
                <Input
                  id={`brand-${key}`}
                  value={form[key]}
                  onChange={event => setForm(prev => ({ ...prev, [key]: event.target.value }))}
                />
              </div>
            ))}
            <div className="grid grid-cols-[4.5rem_1fr] items-center gap-2">
              <label htmlFor="brand-spacing" className="text-muted-foreground">
                间距基准
              </label>
              <select
                id="brand-spacing"
                className={FIELD_CLASS}
                value={form.spacingUnit}
                onChange={event =>
                  setForm(prev => ({ ...prev, spacingUnit: event.target.value as BrandSpec['spacingUnit'] }))
                }
              >
                <option value="4px">4px</option>
                <option value="8px">8px</option>
              </select>
            </div>
            <div className="grid grid-cols-[4.5rem_1fr] items-center gap-2">
              <label htmlFor="brand-radius" className="text-muted-foreground">
                圆角
              </label>
              <select
                id="brand-radius"
                className={FIELD_CLASS}
                value={form.radius}
                onChange={event =>
                  setForm(prev => ({ ...prev, radius: event.target.value as BrandSpec['radius'] }))
                }
              >
                {RADIUS_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-2">
              <label htmlFor="brand-logoPath" className="text-muted-foreground">
                Logo 路径
              </label>
              <Input
                id="brand-logoPath"
                value={form.logoPath}
                placeholder="assets/logo.svg（相对 design/）"
                onChange={event => setForm(prev => ({ ...prev, logoPath: event.target.value }))}
              />
              <Button size="sm" variant="outline" className="shrink-0" onClick={toggleAssets}>
                从素材库选择…
              </Button>
            </div>
            {assetPanel !== 'closed' && (
              <div
                data-testid="brand-asset-list"
                className="max-h-40 overflow-y-auto rounded-md border border-border p-1"
              >
                {assetPanel === 'loading' && (
                  <div className="px-1 py-0.5 text-[11px] text-muted-foreground">
                    正在加载素材…
                  </div>
                )}
                {assetPanel === 'error' && (
                  <div className="flex items-center gap-1 px-1 py-0.5 text-[11px] text-destructive">
                    <span role="alert">{ASSET_LOAD_ERROR}</span>
                    <Button size="sm" onClick={loadAssets}>
                      重试
                    </Button>
                  </div>
                )}
                {assetPanel === 'ready' && assetFiles.length === 0 && (
                  <div className="px-1 py-0.5 text-[11px] text-muted-foreground">{ASSET_EMPTY}</div>
                )}
                {assetPanel === 'ready' &&
                  assetFiles.map(file => (
                    <button
                      key={file}
                      type="button"
                      onClick={() => chooseAsset(file)}
                      className="block w-full truncate rounded px-1 py-0.5 text-left font-mono text-[11px] text-foreground transition-colors hover:bg-secondary"
                    >
                      {file}
                    </button>
                  ))}
              </div>
            )}
            <div className="flex flex-col gap-1">
              <label htmlFor="brand-notes" className="text-muted-foreground">
                使用规则
              </label>
              <textarea
                id="brand-notes"
                className={`${FIELD_CLASS} min-h-20`}
                placeholder="写入 DESIGN.md 的使用规则，例如色彩对比、留白与字重约束。"
                value={form.notes}
                onChange={event => setForm(prev => ({ ...prev, notes: event.target.value }))}
              />
            </div>
          </>
        )}
        {brand !== null && textMode && (
          <>
            <div className="text-muted-foreground">{TEXT_HINT}</div>
            <section className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground">design/DESIGN.md</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={mdSave.status === 'saving'}
                  aria-label="保存 DESIGN.md"
                  onClick={() => saveFile('designMd')}
                >
                  保存
                </Button>
              </div>
              <textarea
                aria-label="DESIGN.md 内容"
                value={designMdText}
                spellCheck={false}
                onChange={event => setDesignMdText(event.target.value)}
                className={`${FIELD_CLASS} max-h-64 overflow-y-auto font-mono text-[11px]`}
                data-testid="design-md-editor"
              />
              {renderSaveState(mdSave, 'DESIGN.md')}
            </section>
            <section className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground">design/tokens.css</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={cssSave.status === 'saving'}
                  aria-label="保存 tokens.css"
                  onClick={() => saveFile('tokensCss')}
                >
                  保存
                </Button>
              </div>
              <textarea
                aria-label="tokens.css 内容"
                value={tokensCssText}
                spellCheck={false}
                onChange={event => setTokensCssText(event.target.value)}
                className={`${FIELD_CLASS} max-h-64 overflow-y-auto font-mono text-[11px]`}
                data-testid="tokens-css-editor"
              />
              {renderSaveState(cssSave, 'tokens.css')}
            </section>
          </>
        )}
      </div>
    </Modal>
  );
}
