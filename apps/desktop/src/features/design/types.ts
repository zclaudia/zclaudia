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
  | 'ANCHOR_REFERENCED';

export class DesignEditError extends Error {
  constructor(
    readonly code: DesignEditErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'DesignEditError';
  }
}

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
