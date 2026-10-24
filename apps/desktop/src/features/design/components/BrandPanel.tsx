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

const FORM_HINT =
  'Generates two brand files, design/DESIGN.md and design/tokens.css; the Agent reads them when editing pages.';
const TEXT_HINT =
  'Edit the brand files directly; saving checks that they were not modified externally.';
const LOADING_LABEL = 'Loading brand files…';
const CREATE_DONE_LABEL = 'Brand files created: design/DESIGN.md, design/tokens.css';
const SAVED_LABEL = 'Saved';
const CONFLICT_LABEL = 'The file was updated elsewhere; reload it';
const ASSET_EMPTY = 'No assets in the workspace yet';
const ASSET_LOAD_ERROR = 'Failed to load the asset list';

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
  { key: 'primary', label: 'Primary' },
  { key: 'secondary', label: 'Secondary' },
  { key: 'background', label: 'Background' },
  { key: 'text', label: 'Text' },
];

const RADIUS_OPTIONS: { value: BrandSpec['radius']; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'sm', label: 'Small 4px' },
  { value: 'md', label: 'Medium 8px' },
  { value: 'lg', label: 'Large 16px' },
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
          Saving…
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
          <Button size="sm" aria-label={`Reload ${fileLabel}`} onClick={load}>
            Reload
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
      ariaLabel="Brand"
      title="Brand"
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          {!textMode && brand !== null && (
            <Button size="sm" variant="primary" disabled={formSaving} onClick={submitForm}>
              Generate brand files
            </Button>
          )}
          <Button size="sm" onClick={onClose}>
            Close
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
              Retry
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
                  {key === 'fontBody' ? 'Body font' : 'Heading font'}
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
                Spacing base
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
                Corner radius
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
                Logo path
              </label>
              <Input
                id="brand-logoPath"
                value={form.logoPath}
                placeholder="assets/logo.svg (relative to design/)"
                onChange={event => setForm(prev => ({ ...prev, logoPath: event.target.value }))}
              />
              <Button size="sm" variant="outline" className="shrink-0" onClick={toggleAssets}>
                Choose from asset library…
              </Button>
            </div>
            {assetPanel !== 'closed' && (
              <div
                data-testid="brand-asset-list"
                className="max-h-40 overflow-y-auto rounded-md border border-border p-1"
              >
                {assetPanel === 'loading' && (
                  <div className="px-1 py-0.5 text-[11px] text-muted-foreground">
                    Loading assets…
                  </div>
                )}
                {assetPanel === 'error' && (
                  <div className="flex items-center gap-1 px-1 py-0.5 text-[11px] text-destructive">
                    <span role="alert">{ASSET_LOAD_ERROR}</span>
                    <Button size="sm" onClick={loadAssets}>
                      Retry
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
                Usage rules
              </label>
              <textarea
                id="brand-notes"
                className={`${FIELD_CLASS} min-h-20`}
                placeholder="Usage rules written to DESIGN.md, e.g. color contrast, whitespace, and font-weight constraints."
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
                  aria-label="Save DESIGN.md"
                  onClick={() => saveFile('designMd')}
                >
                  Save
                </Button>
              </div>
              <textarea
                aria-label="DESIGN.md content"
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
                  aria-label="Save tokens.css"
                  onClick={() => saveFile('tokensCss')}
                >
                  Save
                </Button>
              </div>
              <textarea
                aria-label="tokens.css content"
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
