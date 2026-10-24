export interface DesignDocument {
  path: string;
  source: string;
  revision: string;
}

export interface DesignSelection {
  /** Element-child indexes from document.body to the selected element. */
  elementPath: number[];
  tagName: string;
  text: string;
  /** Text captured from the saved source before preview scripts run. */
  sourceText?: string;
  color?: string;
  backgroundColor?: string;
  /** Draft revision the preview was built from; stale selections are rejected. */
  base?: string;
  /** 桥接携带的计算样式子集（每值 ≤120 字符）；非桥接来源的选区可缺省。 */
  styles?: DesignComputedStyles;
  /** 选中元素的白名单属性现值（src/alt/href，各 ≤500 字符）。 */
  attrs?: Partial<Record<DesignAttributeName, string>>;
  /** 选中元素 style 属性原文（≤2000 字符），编辑器据此标「内联」徽标。 */
  inlineStyle?: string;
}

/** 选区携带的计算样式键集（P3 编辑器初始值来源）。 */
export type DesignComputedStyles = Partial<
  Record<
    | 'font-family'
    | 'font-size'
    | 'font-weight'
    | 'line-height'
    | 'text-align'
    | 'width'
    | 'height'
    | 'margin-top'
    | 'margin-right'
    | 'margin-bottom'
    | 'margin-left'
    | 'padding-top'
    | 'padding-right'
    | 'padding-bottom'
    | 'padding-left'
    | 'border-width'
    | 'border-style'
    | 'border-color'
    | 'border-radius'
    | 'object-fit',
    string
  >
>;

export interface DesignPatch {
  text?: string;
  color?: string;
  backgroundColor?: string;
}

/**
 * P3 可编辑的 inline 样式属性白名单。值只写入选中元素的 style 声明
 * （P1.8 语义）；校验规则见 html/values.ts 的 safeStyleValue。
 */
export type DesignStyleProperty =
  | 'font-family'
  | 'font-size'
  | 'font-weight'
  | 'line-height'
  | 'text-align'
  | 'color'
  | 'background-color'
  | 'width'
  | 'height'
  | 'margin'
  | 'margin-top'
  | 'margin-right'
  | 'margin-bottom'
  | 'margin-left'
  | 'padding'
  | 'padding-top'
  | 'padding-right'
  | 'padding-bottom'
  | 'padding-left'
  | 'border-width'
  | 'border-style'
  | 'border-color'
  | 'border-radius'
  | 'object-fit';

/** 可编辑的元素属性白名单；适用标签：src/alt 仅 img，href 仅 a。 */
export type DesignAttributeName = 'src' | 'alt' | 'href';

/** 受限结构修改（P3.4）：同父级自包含动作，结构操作必须独占事务。 */
export type DesignStructureAction = 'duplicate' | 'delete' | 'move-up' | 'move-down';

export type DesignEditOperation =
  | { kind: 'text'; value: string }
  | { kind: 'style'; property: DesignStyleProperty; value: string | null }
  | { kind: 'attribute'; name: DesignAttributeName; value: string | null }
  | { kind: 'structure'; action: DesignStructureAction };

export interface DesignEditTransaction {
  /** Must equal the SHA-256 revision of the draft the transaction applies to. */
  baseRevision: string;
  locator: DesignSelection;
  operations: DesignEditOperation[];
}

export interface DesignEditResult {
  source: string;
  revision: string;
  /** Updated locator for follow-up edits against the new draft. */
  selection: DesignSelection;
}

export type DesignEditErrorCode =
  | 'REVISION_MISMATCH'
  | 'ELEMENT_NOT_FOUND'
  | 'TAG_MISMATCH'
  | 'TEXT_MISMATCH'
  | 'NOT_PLAIN_TEXT'
  | 'IMPLICIT_ELEMENT'
  | 'DUPLICATE_ATTRIBUTE'
  | 'MALFORMED_HTML'
  | 'INVALID_VALUE'
  | 'EMPTY_TRANSACTION'
  | 'ATTRIBUTE_NOT_ALLOWED'
  | 'STRUCTURE_NOT_ALLOWED'
  | 'ANCHOR_REFERENCED'
  | 'STYLE_SOURCE_NOT_FOUND';

export class DesignEditError extends Error {
  constructor(
    readonly code: DesignEditErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'DesignEditError';
  }
}

// ---------------------------------------------------------------------------
// P3.5 CSS 来源编辑（T0 契约；实现见设计文档 C1–C4 卡）
// ---------------------------------------------------------------------------

/**
 * 预览 `<style>` 来源标记（`data-zclaudia-style-origin`）的值：
 * `@inline/<n>`（入口 HTML 第 n 个自有样式块，n 从 0 起）或工作区相对 CSS 路径。
 * 仅存在于预览 DOM，不写入作品文件。
 */
export type DesignStyleOrigin = string;

/** 桥接上报的单条匹配规则身份（§2）。CSSOM 文本不上屏：声明展示走宿主侧源码解析。 */
export interface DesignMatchedRule {
  origin: DesignStyleOrigin;
  /** 顶层规则索引 + 分组内索引（@media 等嵌套），文档序；与宿主侧 postcss 解析同构。 */
  rulePath: number[];
  /** 命中的那个选择器原文（选择器组逐个 matches 取命中项）。 */
  selectorText: string;
  specificity: [number, number, number];
  /** 该规则内带 !important 的属性名（徽标用）。 */
  importantProps: string[];
}

/** iframe → 宿主 `zclaudia:design-rules` 消息载荷（宿主校验后经 css-source 对齐）。 */
export interface DesignRulesMessage {
  elementPath: number[];
  rules: DesignMatchedRule[];
  truncated?: boolean;
}

/**
 * 声明级样式来源修改 op（§4）。T0 仅定义契约；C3 并入 DesignEditOperation
 * 联合并实现引擎（并入需与 DesignPanel 的 mergeKey/needsReselect 接线同卡落地）。
 */
export interface DesignStyleBlockOperation {
  kind: 'styleBlock';
  /** 入口 HTML `<style>` 块文档序（0 起）。 */
  styleOrdinal: number;
  /** 与 DesignMatchedRule.rulePath 同构的规则索引路径。 */
  rulePath: number[];
  /** 须匹配 STYLE_SOURCE_PROPERTY_PATTERN 且 ≤ STYLE_SOURCE_PROPERTY_MAX。 */
  property: string;
  /** null = 删除声明；否则为经 safeSourceCssValue 校验的新值。 */
  value: string | null;
  /** true 且属性不存在时在规则末尾新增声明。 */
  create: boolean;
}

/** §2/§3/§4 上限集合（桥内裁剪与宿主校验共用）。 */
export const STYLE_RULES_MAX = 200;
export const STYLE_RULE_SELECTOR_MAX = 300;
export const STYLE_SPECIFICITY_MAX = 9999;
export const STYLE_IMPORTANT_PROPS_MAX = 64;
export const STYLE_BLOCK_MAX_BYTES = 1024 * 1024;
export const STYLE_SOURCE_VALUE_MAX = 500;
export const STYLE_SOURCE_PROPERTY_MAX = 64;
export const STYLE_SOURCE_PROPERTY_PATTERN = /^-?[A-Za-z][A-Za-z0-9-]*$/;

export interface DesignSnapshotSummary {
  id: string;
  entryPath: string;
  label: string | null;
  source: 'save' | 'manual' | 'pre-restore' | 'restore';
  complete: boolean;
  incompleteReasons: string[];
  fileCount: number;
  totalBytes: number;
  createdAt: number;
}

export interface DesignSnapshotFile {
  path: string;
  sha256: string;
  bytes: number;
  kind: 'entry' | 'css' | 'image' | 'font' | 'video' | 'other';
  mime: string | null;
}

// ---------------------------------------------------------------------------
// P2 完整静态工作台
// ---------------------------------------------------------------------------

export type DesignViewportPreset = 'fill' | 'desktop' | 'tablet' | 'mobile' | 'custom';

/** fill = 跟随可用宽度（默认）；custom 必须带 width。 */
export interface DesignViewport {
  preset: DesignViewportPreset;
  /** 240–3840；preset === 'fill' 时为 null。 */
  width: number | null;
}

/** mode 'fit' 自动适应可用宽度；manual value 0.25–2。 */
export interface DesignZoom {
  mode: 'fit' | 'manual';
  value: number;
}

export type DesignDependencyKind = 'css' | 'image' | 'font' | 'video' | 'other';

export interface DesignDependencyStat {
  /** 工作区相对路径。 */
  path: string;
  kind: DesignDependencyKind;
  size: number | null;
  missing: boolean;
  mtimeMs: number | null;
}

export interface DesignDepsResult {
  entry: { path: string; size: number; mtimeMs: number };
  files: DesignDependencyStat[];
  skipped: { raw: string; reason: string }[];
}

export type DesignExportMode = 'disk' | 'draft';

export interface DesignExportRequest {
  sessionId: string;
  /** 入口 HTML 工作区相对路径。 */
  path: string;
  mode: DesignExportMode;
  /** disk 模式：当前磁盘哈希；不符 → REVISION_CONFLICT。 */
  expectedRevision?: string;
  /** draft 模式必填；≤ 2 MiB。 */
  draftSource?: string;
  /** 缺资源仍导出（ZIP 清单记录 missing）。 */
  confirmIncomplete?: boolean;
}
