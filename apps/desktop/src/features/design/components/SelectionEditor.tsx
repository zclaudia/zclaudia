import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '../../../components/ui/Button';
import { FIELD_CLASS, Input } from '../../../components/ui/Input';
import { useFileViewerStore } from '../../../stores/fileViewerStore';
import { listDesignAssets } from '../api';
import { relativeAssetRef } from '../asset-ref';
import { childElementPath } from '../element-tree';
import { childElements, findElement, parseDocument } from '../html/parse';
import { parseDeclarations } from '../html/style-declarations';
import { elementLineRange } from '../workspace/source-lines';
import type {
  DesignAttributeName,
  DesignEditOperation,
  DesignSelection,
  DesignStyleProperty,
  DesignStructureAction,
} from '../types';
import {
  BORDER_FIELDS,
  OBJECT_FIT_FIELD,
  SIZE_FIELDS,
  TYPOGRAPHY_FIELDS,
  collectOperations,
  initialStyleValues,
} from '../inspector/collect-operations';
import type { StyleFieldDef, StyleValues } from '../inspector/collect-operations';
import { DEFAULT_SECTION_OPEN, isSectionVisible } from '../inspector/section-matrix';
import type { InspectorSectionId } from '../inspector/section-matrix';
import { InspectorSection } from '../inspector/InspectorSection';

const OVERRIDE_WARNING =
  'Changes were written to the source, but the computed style is overridden by external styles (e.g. !important); written as an inline declaration without raising specificity.';
const LINE_OFFSET_HINT =
  'The file viewer shows the saved version; line numbers may be offset relative to the draft';
const LOCATE_ERROR = 'Cannot locate the source position';
const INVALID_PREFIX = 'Invalid value: ';
const ASSET_LOADING = 'Loading image list…';
const ASSET_LOAD_ERROR = 'Failed to load the image list';
const ASSET_EMPTY = 'No image files in the workspace';
const DELETE_CONFIRM_LABEL = 'Click again to confirm delete';
/** 删除按钮的内联确认窗口（毫秒）。 */
const DELETE_CONFIRM_TIMEOUT = 3000;

type StyleComputed = Partial<Record<DesignStyleProperty, string>>;

/** 计算样式读取口径：margin/padding 等简写属性无计算键，统一按 undefined → 空串。 */
function computedStylesOf(selection: DesignSelection | null): StyleComputed | undefined {
  return selection?.styles as StyleComputed | undefined;
}

function InlineBadge({ testId }: { testId: string }) {
  return (
    <span
      data-testid={testId}
      title="This property comes from the element's style attribute (inline declaration)"
      className="rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground"
    >
      Inline
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
    <div className="grid min-w-0 gap-1 text-xs">
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
            <option value="">No change</option>
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
          aria-label={`Clear ${field.label}`}
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
  /** 分组折叠状态（layout store）；缺省时组件内维护临时状态。 */
  collapsedSections?: Record<string, boolean>;
  onToggleSection?: (id: string) => void;
  /** 空态入口（无选区时的引导）。 */
  onGenerate?: () => void;
  onTemplate?: () => void;
  /** 空态页面信息。 */
  pageInfo?: { fileName: string | null; depCount: number };
}

/**
 * 检查器 Design 页签（P2 §4.5）：按元素类型分组渲染同一批字段，
 * 逻辑（预检/批量提交/导航/结构操作）与拆分前逐条一致。
 * 分组可折叠（状态入 layout store），底部吸底条只在有未提交修改时出现：
 * 仍是一次提交全部字段、一条撤销记录（保留批量 Apply 语义）。
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
  collapsedSections,
  onToggleSection,
  onGenerate,
  onTemplate,
  pageInfo,
}: SelectionEditorProps) {
  const [textValue, setTextValue] = useState(() => selection?.sourceText ?? selection?.text ?? '');
  const [colorValue, setColorValue] = useState(() => selection?.color ?? '');
  const [backgroundValue, setBackgroundValue] = useState(() => selection?.backgroundColor ?? '');
  const [styleValues, setStyleValues] = useState<StyleValues>(() => initialStyleValues(selection));
  const [srcValue, setSrcValue] = useState(() => selection?.attrs?.src ?? '');
  const [altValue, setAltValue] = useState(() => selection?.attrs?.alt ?? '');
  const [hrefValue, setHrefValue] = useState(() => selection?.attrs?.href ?? '');
  /** 预检失败的字段名；非空时整单不提交并在吸底条上方提示。 */
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
  /** 无外部 store 时的折叠兜底（组件测试/独立挂载）。 */
  const [localCollapsed, setLocalCollapsed] = useState<Record<string, boolean>>({});
  const collapsedMap = collapsedSections ?? localCollapsed;

  const resetFields = () => {
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
  };

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
      <section className="flex flex-col gap-3 p-3" aria-label="Selected element">
        <div className="text-[11px] font-medium text-muted-foreground">Selected element</div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Click an element in the preview to edit it. The preview targets static HTML/CSS; do not
          rely on JavaScript rendering or CDN resources.
        </p>
        {(pageInfo || onGenerate || onTemplate) && (
          <div className="grid gap-1 border-t border-border pt-3 text-[11px]">
            {pageInfo?.fileName && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Page</span>
                <span className="truncate font-mono">{pageInfo.fileName}</span>
              </div>
            )}
            {pageInfo && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Dependencies</span>
                <span>{pageInfo.depCount}</span>
              </div>
            )}
          </div>
        )}
        {(onGenerate || onTemplate) && (
          <div className="grid gap-1.5 pt-1">
            {onGenerate && (
              <Button size="sm" variant="outline" className="justify-start" onClick={onGenerate}>
                Ask the Agent to build a page
              </Button>
            )}
            {onTemplate && (
              <Button size="sm" variant="outline" className="justify-start" onClick={onTemplate}>
                Start from template
              </Button>
            )}
          </div>
        )}
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

  const draftValues = {
    textValue,
    colorValue,
    backgroundValue,
    styleValues,
    srcValue,
    altValue,
    hrefValue,
  };

  /** 吸底条的 pending 计数：合法操作 + 预检失败字段（两者都是未提交修改）。 */
  const pendingResult = collectOperations(draftValues, selection, computedStyles);
  const pending = pendingResult.operations.length + pendingResult.invalid.length;

  const applyChanges = () => {
    const result = collectOperations(draftValues, selection, computedStyles);
    if (result.invalid.length > 0) {
      setInvalidLabels(result.invalid);
      return;
    }
    setInvalidLabels([]);
    onApply(result.operations);
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

  const isOpen = (id: InspectorSectionId): boolean =>
    !(collapsedMap[id] ?? !DEFAULT_SECTION_OPEN[id]);

  const toggleSection = (id: InspectorSectionId) => {
    if (onToggleSection) onToggleSection(id);
    else
      setLocalCollapsed(previous => ({
        ...previous,
        [id]: !(previous[id] ?? !DEFAULT_SECTION_OPEN[id]),
      }));
  };

  const section = (id: InspectorSectionId, title: string, children: ReactNode) =>
    isSectionVisible(id, selection.tagName) ? (
      <InspectorSection
        key={id}
        id={id}
        title={title}
        open={isOpen(id)}
        onToggle={() => toggleSection(id)}
      >
        {children}
      </InspectorSection>
    ) : null;

  return (
    <section className="flex min-h-full flex-col" aria-label="Selected element">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 font-mono text-[11px] text-muted-foreground">
        <span className="min-w-0 truncate">
          &lt;{selection.tagName}&gt; · {selection.elementPath.join('.')}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            aria-label="Parent"
            disabled={!onSelectPath || elementPathEmpty}
            onClick={() => onSelectPath?.(selection.elementPath.slice(0, -1))}
          >
            Parent
          </Button>
          <Button
            size="sm"
            aria-label="Child"
            disabled={!onSelectPath || docSource === null || childPath === null}
            onClick={() => {
              if (childPath) onSelectPath?.(childPath);
            }}
          >
            Child
          </Button>
        </span>
      </div>
      {overrideWarning && (
        <div role="status" className="px-3 pt-2 text-xs text-warning">
          {OVERRIDE_WARNING}
        </div>
      )}

      {section(
        'text',
        'Text',
        <textarea
          aria-label="Element text"
          className={`${FIELD_CLASS} resize-y`}
          rows={2}
          value={textValue}
          onChange={e => setTextValue(e.target.value)}
        />
      )}

      {section(
        'link',
        'Link',
        <div className="grid gap-1 text-xs">
          <span>Link URL</span>
          <span className="flex items-center gap-1">
            <Input
              aria-label="Link URL"
              value={hrefValue}
              placeholder="page.html or https://…"
              disabled={busy}
              aria-invalid={invalidLabels.includes('Link URL') || undefined}
              onChange={e => setHrefValue(e.target.value)}
            />
            <Button
              size="sm"
              className="shrink-0"
              disabled={busy}
              aria-label="Clear link URL"
              onClick={() => clearAttribute('href')}
            >
              ×
            </Button>
          </span>
        </div>
      )}

      {section(
        'image',
        'Image',
        <>
          <div className="grid gap-1 text-xs">
            <span>Image URL</span>
            <span className="flex items-center gap-1">
              <Input
                aria-label="Image URL"
                value={srcValue}
                placeholder="assets/photo.png"
                disabled={busy}
                aria-invalid={invalidLabels.includes('Image URL') || undefined}
                onChange={e => setSrcValue(e.target.value)}
              />
              <Button
                size="sm"
                className="shrink-0"
                disabled={busy || !sessionId}
                aria-label="Choose image"
                onClick={toggleAssetPanel}
              >
                Browse…
              </Button>
              <Button
                size="sm"
                className="shrink-0"
                disabled={busy}
                aria-label="Clear image URL"
                onClick={() => clearAttribute('src')}
              >
                Clear
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
                      Retry
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
            <span>Alt text</span>
            <span className="flex items-center gap-1">
              <Input
                aria-label="Alt text"
                value={altValue}
                disabled={busy}
                aria-invalid={invalidLabels.includes('Alt text') || undefined}
                onChange={e => setAltValue(e.target.value)}
              />
              <Button
                size="sm"
                className="shrink-0"
                disabled={busy}
                aria-label="Clear alt text"
                onClick={() => clearAttribute('alt')}
              >
                ×
              </Button>
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">{renderStyleField(OBJECT_FIT_FIELD)}</div>
        </>
      )}

      {section(
        'typography',
        'Typography',
        <div className="grid grid-cols-2 gap-2">{TYPOGRAPHY_FIELDS.map(renderStyleField)}</div>
      )}

      {section(
        'fill-border',
        'Fill & border',
        <>
          <div className="grid grid-cols-2 gap-2">
            {selection.tagName !== 'img' && (
            <div className="grid gap-1 text-xs">
              <span className="flex items-center gap-1">
                Text color
                {inlineNames.has('color') && <InlineBadge testId="inline-badge-color" />}
              </span>
              <div className="flex items-center gap-1">
                <Input
                  aria-label="Text color"
                  value={colorValue}
                  placeholder="#000000"
                  disabled={busy}
                  onChange={e => setColorValue(e.target.value)}
                />
                <Button
                  size="sm"
                  className="shrink-0"
                  disabled={busy}
                  aria-label="Clear text color"
                  onClick={() => onApply([{ kind: 'style', property: 'color', value: null }])}
                >
                  Clear text color
                </Button>
              </div>
            </div>
            )}
            <div className="grid gap-1 text-xs">
              <span className="flex items-center gap-1">
                Background color
                {inlineNames.has('background-color') && (
                  <InlineBadge testId="inline-badge-background-color" />
                )}
              </span>
              <div className="flex items-center gap-1">
                <Input
                  aria-label="Background color"
                  value={backgroundValue}
                  placeholder="transparent"
                  disabled={busy}
                  onChange={e => setBackgroundValue(e.target.value)}
                />
                <Button
                  size="sm"
                  className="shrink-0"
                  disabled={busy}
                  aria-label="Clear background color"
                  onClick={() => onApply([{ kind: 'style', property: 'background-color', value: null }])}
                >
                  Clear background color
                </Button>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">{BORDER_FIELDS.map(renderStyleField)}</div>
        </>
      )}

      {section(
        'size-spacing',
        'Size & spacing',
        <div className="grid grid-cols-2 gap-2">{SIZE_FIELDS.map(renderStyleField)}</div>
      )}

      {section(
        'structure',
        'Structure',
        <>
          <div className="flex flex-wrap items-center gap-1">
            <Button size="sm" disabled={structureDisabled} onClick={() => submitStructure('duplicate')}>
              Copy
            </Button>
            <Button
              size="sm"
              variant={confirmDelete ? 'destructive' : 'ghost'}
              disabled={structureDisabled}
              aria-label="Delete element"
              onClick={handleDeleteClick}
            >
              {confirmDelete ? DELETE_CONFIRM_LABEL : 'Delete'}
            </Button>
            <Button size="sm" disabled={!canMoveUp} onClick={() => submitStructure('move-up')}>
              Move up
            </Button>
            <Button size="sm" disabled={!canMoveDown} onClick={() => submitStructure('move-down')}>
              Move down
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              onClick={viewSource}
              disabled={busy || !docSource || !docPath}
              aria-label="View source"
            >
              View source
            </Button>
            {dirty && <span className="text-[10px] text-muted-foreground">{LINE_OFFSET_HINT}</span>}
          </div>
        </>
      )}

      {locateFailed === selection && (
        <div role="alert" className="px-3 pt-2 text-xs text-destructive">
          {LOCATE_ERROR}
        </div>
      )}
      {invalidLabels.length > 0 && (
        <div role="alert" className="px-3 pt-2 text-xs text-destructive">
          {invalidLabels.map(label => (
            <div key={label}>
              {INVALID_PREFIX}
              {label}
            </div>
          ))}
        </div>
      )}

      {pending > 0 && (
        <div className="sticky bottom-0 z-10 mt-auto flex items-center gap-2 border-t border-border bg-background/95 px-3 py-2 backdrop-blur">
          <span className="min-w-0 truncate text-[11px] text-muted-foreground">
            {pending} pending change{pending === 1 ? '' : 's'}
          </span>
          <span className="flex-1" />
          <Button size="sm" className="shrink-0 whitespace-nowrap" onClick={resetFields} disabled={busy}>
            Discard
          </Button>
          <Button
            size="sm"
            variant="primary"
            className="shrink-0 whitespace-nowrap"
            onClick={applyChanges}
            disabled={busy}
          >
            Apply changes
          </Button>
        </div>
      )}
    </section>
  );
}
