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
}

export interface DesignPatch {
  text?: string;
  color?: string;
  backgroundColor?: string;
}

export type DesignStyleProperty = 'color' | 'background-color';

export type DesignEditOperation =
  | { kind: 'text'; value: string }
  | { kind: 'style'; property: DesignStyleProperty; value: string | null };

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
  | 'EMPTY_TRANSACTION';

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
  kind: 'entry' | 'css' | 'image' | 'font' | 'other';
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

export type DesignDependencyKind = 'css' | 'image' | 'font' | 'other';

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
