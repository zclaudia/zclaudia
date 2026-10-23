import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '../../../components/ui/Button';
import { FIELD_CLASS, Input } from '../../../components/ui/Input';
import { useFileViewerStore } from '../../../stores/fileViewerStore';
import { listDesignAssets } from '../api';
import { relativeAssetRef } from '../asset-ref';
import { childElementPath } from '../element-tree';
import { childElements, findElement, parseDocument } from '../html/parse';
import { parseDeclarations } from '../html/style-declarations';
import { safeAttrValue, safeStyleValue } from '../html/values';
import { elementLineRange } from '../workspace/source-lines';
import type {
  DesignAttributeName,
  DesignEditOperation,
  DesignSelection,
  DesignStyleProperty,
  DesignStructureAction,
} from '../types';

const OVERRIDE_WARNING =
  '修改已写入源码，但计算样式仍被外部样式覆盖（如 !important）；已按内联声明写入，未提高优先级。';
const LINE_OFFSET_HINT = '文件查看器显示已保存版本，行号以草稿计算可能有偏移';
const LOCATE_ERROR = '无法定位源码位置';
const INVALID_PREFIX = '值无效：';
const ASSET_LOADING = '正在加载图片清单…';
const ASSET_LOAD_ERROR = '图片清单加载失败';
const ASSET_EMPTY = '工作区没有图片文件';
const DELETE_CONFIRM_LABEL = '再次点击确认删除';
/** 删除按钮的内联确认窗口（毫秒）。 */
const DELETE_CONFIRM_TIMEOUT = 3000;

const TEXT_ALIGN_OPTIONS: readonly string[] = ['left', 'center', 'right', 'justify', 'start', 'end'];
const BORDER_STYLE_OPTIONS: readonly string[] = [
  'none',
  'hidden',
  'solid',
  'dashed',
  'dotted',
  'double',
  'groove',
  'ridge',
  'inset',
  'outset',
];
const OBJECT_FIT_OPTIONS: readonly string[] = ['fill', 'contain', 'cover', 'none', 'scale-down'];

interface StyleFieldDef {
  property: DesignStyleProperty;
  label: string;
  kind: 'input' | 'select';
  options?: readonly string[];
  placeholder?: string;
}

const TYPOGRAPHY_FIELDS: StyleFieldDef[] = [
  { property: 'font-family', label: '字体', kind: 'input', placeholder: 'sans-serif' },
  { property: 'font-size', label: '字号', kind: 'input', placeholder: '16px' },
  { property: 'line-height', label: '行高', kind: 'input', placeholder: '1.5' },
  { property: 'font-weight', label: '字重', kind: 'input', placeholder: 'normal / bold / 400' },
  { property: 'text-align', label: '对齐', kind: 'select', options: TEXT_ALIGN_OPTIONS },
];

const SIZE_FIELDS: StyleFieldDef[] = [
  { property: 'width', label: '宽度', kind: 'input', placeholder: 'auto' },
  { property: 'height', label: '高度', kind: 'input', placeholder: 'auto' },
  { property: 'margin', label: '外边距', kind: 'input', placeholder: '8px 12px' },
  { property: 'padding', label: '内边距', kind: 'input', placeholder: '8px 12px' },
];

const BORDER_FIELDS: StyleFieldDef[] = [
  { property: 'border-width', label: '边框宽度', kind: 'input', placeholder: '1px' },
  { property: 'border-color', label: '边框颜色', kind: 'input', placeholder: '#000000' },
  { property: 'border-radius', label: '圆角', kind: 'input', placeholder: '4px' },
  {
    property: 'border-style',
    label: '边框样式',
    kind: 'select',
    options: BORDER_STYLE_OPTIONS,
  },
];

const OBJECT_FIT_FIELD: StyleFieldDef = {
  property: 'object-fit',
  label: '显示方式',
  kind: 'select',
  options: OBJECT_FIT_OPTIONS,
};

/** 参与应用预检的全部样式字段（margin/padding 简写无计算值键，读取时按 undefined 处理）。 */
const APPLICABLE_STYLE_FIELDS: StyleFieldDef[] = [
  ...TYPOGRAPHY_FIELDS,
  ...SIZE_FIELDS,
  ...BORDER_FIELDS,
  OBJECT_FIT_FIELD,
];

type StyleValues = Partial<Record<DesignStyleProperty, string>>;

/** 计算样式读取口径：margin/padding 等简写属性无计算键，统一按 undefined → 空串。 */
function computedStylesOf(selection: DesignSelection | null): Partial<Record<DesignStyleProperty, string>> | undefined {
  return selection?.styles as Partial<Record<DesignStyleProperty, string>> | undefined;
}

/** 字段初始值：select 型仅当计算值命中选项时选中（大小写不敏感），否则空 = 不修改。 */
function initialStyleValue(field: StyleFieldDef, selection: DesignSelection | null): string {
  const raw = computedStylesOf(selection)?.[field.property] ?? '';
  if (field.kind === 'select') {
    const keyword = raw.toLowerCase();
    return field.options?.includes(keyword) ? keyword : '';
  }
  return raw;
}

function initialStyleValues(selection: DesignSelection | null): StyleValues {
  const values: StyleValues = {};
  for (const field of APPLICABLE_STYLE_FIELDS) {
    values[field.property] = initialStyleValue(field, selection);
  }
  return values;
}

function GroupTitle({ children }: { children: ReactNode }) {
  return <div className="text-[11px] font-medium text-muted-foreground">{children}</div>;
}

function InlineBadge({ testId }: { testId: string }) {
  return (
    <span
      data-testid={testId}
      title="该属性来自元素 style 属性（内联声明）"
      className="rounded bg-muted px-1 text-[9px] font-medium text-muted-foreground"
    >
      内联
    </span>
  );
}

interface StyleFieldRowProps {
  field: StyleFieldDef;
  value: string;
  invalid: boolean;
  inline: boolean;
  busy: boolean;
  onChange: (value: string) => void;
  onClear: () => void;
}

function StyleFieldRow({ field, value, invalid, inline, busy, onChange, onClear }: StyleFieldRowProps) {
  return (
    <div className="grid gap-1 text-xs">
      <span className="flex items-center gap-1">
        {field.label}
        {inline && <InlineBadge testId={`inline-badge-${field.property}`} />}
      </span>
      <span className="flex items-center gap-1">
        {field.kind === 'input' ? (
          <Input
            aria-label={field.label}
            value={value}
            placeholder={field.placeholder}
            disabled={busy}
            aria-invalid={invalid || undefined}
            onChange={event => onChange(event.target.value)}
          />
        ) : (
          <select
            aria-label={field.label}
            value={value}
            disabled={busy}
            className={FIELD_CLASS}
            onChange={event => onChange(event.target.value)}
          >
            <option value="">不修改</option>
            {field.options?.map(option => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        )}
        <Button
          size="sm"
          className="shrink-0"
          disabled={busy}
          aria-label={`清除${field.label}`}
          onClick={onClear}
        >
          ×
        </Button>
      </span>
    </div>
  );
}

export interface SelectionEditorProps {
  selection: DesignSelection | null;
  busy: boolean;
  overrideWarning: boolean;
  /** 活动页草稿全文；源码行号以草稿计算。null 时禁用「查看源码」。 */
  docSource: string | null;
  /** 活动页工作区相对路径（fileViewer 的打开入口，也是图片相对引用的基准）。 */
  docPath: string | null;
  /** 活动页是否 dirty：fileViewer 只显示磁盘版本，行号可能有偏移。 */
  dirty: boolean;
  /** fileViewer 入参（workspace 工具上下文经 props 传入）。 */
  projectRoot?: string;
  backendId?: string;
  /** 会话 id：图片清单拉取用；缺省时「选择…」按钮禁用。 */
  sessionId?: string | null;
  /** 预览元素导航（父级/子级）；缺省时两个按钮禁用。 */
  onSelectPath?: (path: number[]) => void;
  onApply: (operations: DesignEditOperation[]) => void;
}

/**
 * Form for the element selected in the preview（P3 §2.3 分组表单）：
 * 文字/颜色、排版、尺寸与间距、边框，img 追加图片组、a 追加链接组；
 * 应用按钮一次提交全部变更并做客户端预检，另有导航（父级/子级）与
 * 受限结构操作（复制/删除/上移/下移）。
 */
export function SelectionEditor({
  selection,
  busy,
  overrideWarning,
  docSource,
  docPath,
  dirty,
  projectRoot,
  backendId,
  sessionId,
  onSelectPath,
  onApply,
}: SelectionEditorProps) {
  const [textValue, setTextValue] = useState(() => selection?.sourceText ?? selection?.text ?? '');
  const [colorValue, setColorValue] = useState(() => selection?.color ?? '');
  const [backgroundValue, setBackgroundValue] = useState(() => selection?.backgroundColor ?? '');
  const [styleValues, setStyleValues] = useState<StyleValues>(() => initialStyleValues(selection));
  const [srcValue, setSrcValue] = useState(() => selection?.attrs?.src ?? '');
  const [altValue, setAltValue] = useState(() => selection?.attrs?.alt ?? '');
  const [hrefValue, setHrefValue] = useState(() => selection?.attrs?.href ?? '');
  /** 预检失败的字段中文名；非空时整单不提交并在应用按钮下方提示。 */
  const [invalidLabels, setInvalidLabels] = useState<string[]>([]);
  /** 定位失败的选区；仅对发起跳转的那次选区显示错误，选区变化即失效。 */
  const [locateFailed, setLocateFailed] = useState<DesignSelection | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteTimerRef = useRef<number | null>(null);
  /** 图片清单面板：按 backendId+sessionId 缓存于组件 state，面板生命期内复用。 */
  const [assetPanelOpen, setAssetPanelOpen] = useState(false);
  const [assetState, setAssetState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [assetFiles, setAssetFiles] = useState<string[]>([]);
  const assetCacheRef = useRef<{ key: string; files: string[] } | null>(null);

  // 选区变化重置全部字段与瞬时状态（沿用既有 useEffect 模式）。
  useEffect(() => {
    setTextValue(selection?.sourceText ?? selection?.text ?? '');
    setColorValue(selection?.color ?? '');
    setBackgroundValue(selection?.backgroundColor ?? '');
    setStyleValues(initialStyleValues(selection));
    setSrcValue(selection?.attrs?.src ?? '');
    setAltValue(selection?.attrs?.alt ?? '');
    setHrefValue(selection?.attrs?.href ?? '');
    setInvalidLabels([]);
    setConfirmDelete(false);
    setAssetPanelOpen(false);
  }, [selection]);

  useEffect(
    () => () => {
      if (deleteTimerRef.current !== null) window.clearTimeout(deleteTimerRef.current);
    },
    []
  );

  // 文档解析只随 docSource 变化（选区切换不重解析）；选区相关派生只做轻量树行走。
  const parsedDoc = useMemo(() => parseDocument(docSource ?? ''), [docSource]);
  const childPath = useMemo<number[] | null>(() => {
    if (!selection || !docSource) return null;
    return childElementPath(docSource, selection.elementPath);
  }, [docSource, selection]);
  const siblingInfo = useMemo<{ index: number; count: number }>(() => {
    const path = selection?.elementPath ?? [];
    if (!docSource || path.length === 0) return { index: -1, count: 0 };
    const parent = findElement(parsedDoc.document, path.slice(0, -1));
    const siblings = parent ? childElements(parent) : [];
    return { index: path[path.length - 1] ?? -1, count: siblings.length };
  }, [docSource, parsedDoc, selection]);

  /** inlineStyle 里的属性名集合（parseDeclarations 同名取最后一条）——「内联」徽标依据。 */
  const inlineNames = useMemo(() => {
    const names = new Set<string>();
    for (const declaration of parseDeclarations(selection?.inlineStyle ?? '')) {
      names.add(declaration.name.toLowerCase());
    }
    return names;
  }, [selection?.inlineStyle]);

  if (!selection) {
    return (
      <section className="flex flex-col gap-3" aria-label="选中元素">
        <div className="text-[11px] font-medium text-muted-foreground">选中元素</div>
        <p className="text-xs text-muted-foreground">
          点击预览中的元素进行编辑。预览面向静态 HTML/CSS；请勿依赖 JavaScript 渲染或 CDN
          外链资源。
        </p>
      </section>
    );
  }

  const computedStyles = computedStylesOf(selection);
  const elementPathEmpty = selection.elementPath.length === 0;

  const setStyleField = (property: DesignStyleProperty, value: string) => {
    setStyleValues(previous => ({ ...previous, [property]: value }));
  };

  const clearStyleField = (property: DesignStyleProperty) => {
    onApply([{ kind: 'style', property, value: null }]);
  };

  const clearAttribute = (name: DesignAttributeName) => {
    onApply([{ kind: 'attribute', name, value: null }]);
  };

  /**
   * 收集待提交操作：与初始值不同且 trim 非空的字段；颜色两字段沿用宽松行为
   * （非空即提交，引擎 safeColor 兜底），其余 style/attribute 字段逐个过
   * safeStyleValue/safeAttrValue 预检——任何非法字段整单不提交并返回 null。
   */
  const collectOperations = (): DesignEditOperation[] | null => {
    const operations: DesignEditOperation[] = [];
    const invalid: string[] = [];
    if (textValue !== (selection.sourceText ?? selection.text)) {
      operations.push({ kind: 'text', value: textValue });
    }
    if (colorValue.trim() && colorValue !== (selection.color ?? '')) {
      operations.push({ kind: 'style', property: 'color', value: colorValue });
    }
    if (backgroundValue.trim() && backgroundValue !== (selection.backgroundColor ?? '')) {
      operations.push({ kind: 'style', property: 'background-color', value: backgroundValue });
    }
    for (const field of APPLICABLE_STYLE_FIELDS) {
      const value = styleValues[field.property] ?? '';
      if (!value.trim() || value === (computedStyles?.[field.property] ?? '')) continue;
      const safe = safeStyleValue(field.property, value);
      if (safe === null) {
        invalid.push(field.label);
        continue;
      }
      operations.push({ kind: 'style', property: field.property, value: safe });
    }
    const attributeFields: Array<{ name: DesignAttributeName; label: string; value: string }> = [];
    if (selection.tagName === 'img') {
      attributeFields.push(
        { name: 'src', label: '图片地址', value: srcValue },
        { name: 'alt', label: '替代文本', value: altValue }
      );
    }
    if (selection.tagName === 'a') {
      attributeFields.push({ name: 'href', label: '链接地址', value: hrefValue });
    }
    for (const field of attributeFields) {
      if (!field.value.trim() || field.value === (selection.attrs?.[field.name] ?? '')) continue;
      const safe = safeAttrValue(field.name, field.value, selection.tagName);
      if (safe === null) {
        invalid.push(field.label);
        continue;
      }
      operations.push({ kind: 'attribute', name: field.name, value: safe });
    }
    if (invalid.length > 0) {
      setInvalidLabels(invalid);
      return null;
    }
    return operations;
  };

  const applyChanges = () => {
    const operations = collectOperations();
    if (operations === null) return;
    setInvalidLabels([]);
    onApply(operations);
  };

  /** 查看源码（P2 §5.2）：行号基于草稿计算；fileViewer 永远显示磁盘版本。 */
  const viewSource = () => {
    if (!docSource || !docPath) return;
    const range = elementLineRange(
      docSource,
      selection.elementPath,
      selection.tagName,
      selection.sourceText
    );
    if (!range) {
      setLocateFailed(selection);
      return;
    }
    setLocateFailed(null);
    useFileViewerStore
      .getState()
      .openFile(projectRoot ?? '', docPath, range.startLine, range.endLine, backendId);
  };

  const assetCacheKey = `${backendId ?? ''}\n${sessionId ?? ''}`;

  const fetchAssets = (force: boolean) => {
    if (!sessionId) return;
    if (!force && assetCacheRef.current?.key === assetCacheKey) {
      setAssetFiles(assetCacheRef.current.files);
      setAssetState('ready');
      return;
    }
    setAssetState('loading');
    listDesignAssets(backendId ?? '', sessionId)
      .then(result => {
        assetCacheRef.current = { key: assetCacheKey, files: result.files };
        setAssetFiles(result.files);
        setAssetState('ready');
      })
      .catch(() => {
        setAssetState('error');
      });
  };

  const toggleAssetPanel = () => {
    if (assetPanelOpen) {
      setAssetPanelOpen(false);
      return;
    }
    setAssetPanelOpen(true);
    fetchAssets(false);
  };

  /** 选中清单项：写入相对当前文档目录的引用，保持可移植（§5.2）。 */
  const chooseAsset = (file: string) => {
    setSrcValue(relativeAssetRef(docPath ?? '', file));
    setAssetPanelOpen(false);
  };

  const structureDisabled = busy || elementPathEmpty || docSource === null;
  const canMoveUp = !structureDisabled && siblingInfo.index > 0 && siblingInfo.index < siblingInfo.count;
  const canMoveDown =
    !structureDisabled && siblingInfo.index >= 0 && siblingInfo.index < siblingInfo.count - 1;

  const submitStructure = (action: DesignStructureAction) => {
    onApply([{ kind: 'structure', action }]);
  };

  /** 删除走「再次点击确认」内联确认：3 秒未再点自动复原，第二次点击才提交。 */
  const handleDeleteClick = () => {
    if (deleteTimerRef.current !== null) {
      window.clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = null;
    }
    if (!confirmDelete) {
      setConfirmDelete(true);
      deleteTimerRef.current = window.setTimeout(() => {
        deleteTimerRef.current = null;
        setConfirmDelete(false);
      }, DELETE_CONFIRM_TIMEOUT);
      return;
    }
    setConfirmDelete(false);
    onApply([{ kind: 'structure', action: 'delete' }]);
  };

  const renderStyleField = (field: StyleFieldDef) => (
    <StyleFieldRow
      key={field.property}
      field={field}
      value={styleValues[field.property] ?? ''}
      invalid={invalidLabels.includes(field.label)}
      inline={inlineNames.has(field.property)}
      busy={busy}
      onChange={value => setStyleField(field.property, value)}
      onClear={() => clearStyleField(field.property)}
    />
  );

  return (
    <section className="flex flex-col gap-3" aria-label="选中元素">
      <div className="text-[11px] font-medium text-muted-foreground">选中元素</div>
      <div className="flex items-center justify-between font-mono text-xs text-muted-foreground">
        <span>
          &lt;{selection.tagName}&gt; · {selection.elementPath.join('.')}
        </span>
        <span className="flex items-center gap-1">
          <Button
            size="sm"
            aria-label="父级"
            disabled={!onSelectPath || elementPathEmpty}
            onClick={() => onSelectPath?.(selection.elementPath.slice(0, -1))}
          >
            父级
          </Button>
          <Button
            size="sm"
            aria-label="子级"
            disabled={!onSelectPath || docSource === null || childPath === null}
            onClick={() => {
              if (childPath) onSelectPath?.(childPath);
            }}
          >
            子级
          </Button>
        </span>
      </div>
      {overrideWarning && (
        <div role="status" className="text-xs text-warning">
          {OVERRIDE_WARNING}
        </div>
      )}
      <label className="grid gap-1 text-xs">
        文字
        <textarea
          aria-label="元素文字"
          className={`${FIELD_CLASS} resize-y`}
          rows={2}
          value={textValue}
          onChange={e => setTextValue(e.target.value)}
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-1 text-xs">
          <span className="flex items-center gap-1">
            文字颜色
            {inlineNames.has('color') && <InlineBadge testId="inline-badge-color" />}
          </span>
          <div className="flex items-center gap-1">
            <Input
              aria-label="文字颜色"
              value={colorValue}
              placeholder="#000000"
              disabled={busy}
              onChange={e => setColorValue(e.target.value)}
            />
            <Button
              size="sm"
              className="shrink-0"
              disabled={busy}
              aria-label="清除文字颜色"
              onClick={() => onApply([{ kind: 'style', property: 'color', value: null }])}
            >
              清除文字颜色
            </Button>
          </div>
        </div>
        <div className="grid gap-1 text-xs">
          <span className="flex items-center gap-1">
            背景颜色
            {inlineNames.has('background-color') && <InlineBadge testId="inline-badge-background-color" />}
          </span>
          <div className="flex items-center gap-1">
            <Input
              aria-label="背景颜色"
              value={backgroundValue}
              placeholder="transparent"
              disabled={busy}
              onChange={e => setBackgroundValue(e.target.value)}
            />
            <Button
              size="sm"
              className="shrink-0"
              disabled={busy}
              aria-label="清除背景颜色"
              onClick={() => onApply([{ kind: 'style', property: 'background-color', value: null }])}
            >
              清除背景颜色
            </Button>
          </div>
        </div>
      </div>
      <div className="grid gap-2">
        <GroupTitle>排版</GroupTitle>
        <div className="grid grid-cols-2 gap-2">
          {TYPOGRAPHY_FIELDS.map(renderStyleField)}
        </div>
      </div>
      <div className="grid gap-2">
        <GroupTitle>尺寸与间距</GroupTitle>
        <div className="grid grid-cols-2 gap-2">{SIZE_FIELDS.map(renderStyleField)}</div>
      </div>
      <div className="grid gap-2">
        <GroupTitle>边框</GroupTitle>
        <div className="grid grid-cols-2 gap-2">{BORDER_FIELDS.map(renderStyleField)}</div>
      </div>
      {selection.tagName === 'img' && (
        <div className="grid gap-2">
          <GroupTitle>图片</GroupTitle>
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2 grid gap-1 text-xs">
              <span>图片地址</span>
              <span className="flex items-center gap-1">
                <Input
                  aria-label="图片地址"
                  value={srcValue}
                  placeholder="assets/photo.png"
                  disabled={busy}
                  aria-invalid={invalidLabels.includes('图片地址') || undefined}
                  onChange={e => setSrcValue(e.target.value)}
                />
                <Button
                  size="sm"
                  className="shrink-0"
                  disabled={busy || !sessionId}
                  aria-label="选择图片"
                  onClick={toggleAssetPanel}
                >
                  选择…
                </Button>
                <Button
                  size="sm"
                  className="shrink-0"
                  disabled={busy}
                  aria-label="清除图片地址"
                  onClick={() => clearAttribute('src')}
                >
                  清除
                </Button>
              </span>
              {assetPanelOpen && (
                <div
                  data-testid="asset-list"
                  className="max-h-40 overflow-y-auto rounded-md border border-border p-1"
                >
                  {assetState === 'loading' && (
                    <div className="px-1 py-0.5 text-[11px] text-muted-foreground">{ASSET_LOADING}</div>
                  )}
                  {assetState === 'error' && (
                    <div className="flex items-center gap-1 px-1 py-0.5 text-[11px] text-destructive">
                      <span role="alert">{ASSET_LOAD_ERROR}</span>
                      <Button size="sm" onClick={() => fetchAssets(true)}>
                        重试
                      </Button>
                    </div>
                  )}
                  {assetState === 'ready' && assetFiles.length === 0 && (
                    <div className="px-1 py-0.5 text-[11px] text-muted-foreground">{ASSET_EMPTY}</div>
                  )}
                  {assetState === 'ready' &&
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
            </div>
            <div className="grid gap-1 text-xs">
              <span>替代文本</span>
              <span className="flex items-center gap-1">
                <Input
                  aria-label="替代文本"
                  value={altValue}
                  disabled={busy}
                  aria-invalid={invalidLabels.includes('替代文本') || undefined}
                  onChange={e => setAltValue(e.target.value)}
                />
                <Button
                  size="sm"
                  className="shrink-0"
                  disabled={busy}
                  aria-label="清除替代文本"
                  onClick={() => clearAttribute('alt')}
                >
                  ×
                </Button>
              </span>
            </div>
            {renderStyleField(OBJECT_FIT_FIELD)}
          </div>
        </div>
      )}
      {selection.tagName === 'a' && (
        <div className="grid gap-2">
          <GroupTitle>链接</GroupTitle>
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2 grid gap-1 text-xs">
              <span>链接地址</span>
              <span className="flex items-center gap-1">
                <Input
                  aria-label="链接地址"
                  value={hrefValue}
                  placeholder="page.html 或 https://…"
                  disabled={busy}
                  aria-invalid={invalidLabels.includes('链接地址') || undefined}
                  onChange={e => setHrefValue(e.target.value)}
                />
                <Button
                  size="sm"
                  className="shrink-0"
                  disabled={busy}
                  aria-label="清除链接地址"
                  onClick={() => clearAttribute('href')}
                >
                  ×
                </Button>
              </span>
            </div>
          </div>
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="primary" onClick={applyChanges} disabled={busy}>
          应用修改
        </Button>
        <Button
          size="sm"
          onClick={viewSource}
          disabled={busy || !docSource || !docPath}
          aria-label="查看源码"
        >
          查看源码
        </Button>
      </div>
      {invalidLabels.length > 0 && (
        <div className="text-xs text-destructive">
          {invalidLabels.map(label => (
            <div key={label}>
              {INVALID_PREFIX}
              {label}
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1 border-t border-border pt-2">
        <span className="text-[11px] font-medium text-muted-foreground">结构</span>
        <Button size="sm" disabled={structureDisabled} onClick={() => submitStructure('duplicate')}>
          复制
        </Button>
        <Button
          size="sm"
          variant={confirmDelete ? 'destructive' : 'ghost'}
          disabled={structureDisabled}
          aria-label="删除元素"
          onClick={handleDeleteClick}
        >
          {confirmDelete ? DELETE_CONFIRM_LABEL : '删除'}
        </Button>
        <Button size="sm" disabled={!canMoveUp} onClick={() => submitStructure('move-up')}>
          上移
        </Button>
        <Button size="sm" disabled={!canMoveDown} onClick={() => submitStructure('move-down')}>
          下移
        </Button>
      </div>
      {locateFailed === selection && (
        <div role="alert" className="text-xs text-destructive">
          {LOCATE_ERROR}
        </div>
      )}
      {dirty && <div className="text-[10px] text-muted-foreground">{LINE_OFFSET_HINT}</div>}
    </section>
  );
}
