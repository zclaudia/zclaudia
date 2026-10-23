// P7 分享与审阅共享契约：类型 + 常量 + 纯守卫（无 DB / IO 逻辑）。
// 设计文档：docs/plans/2026-10-24-design-workbench-p7-implementation-plan.md §1/§2。
// 本文件为多卡（S1–S4）共同依赖的冻结契约，行为性实现禁止落在其中。

// ---------------------------------------------------------------------------
// 访问范围 / 摘要形态
// ---------------------------------------------------------------------------

/** link = 任何持有 token 的访问者；local = 仅限本机请求（isLocalhost 判定）。 */
export type DesignShareScope = 'link' | 'local';

export interface DesignShareSummary {
  id: string;
  token: string;
  snapshotId: string;
  /** 工作区相对入口路径（快照行的 entry_path）。 */
  entryPath: string;
  title: string | null;
  scope: DesignShareScope;
  createdAt: number;
  /** null = 永不过期。 */
  expiresAt: number | null;
  /** null = 未撤销。 */
  revokedAt: number | null;
  commentCount: number;
  /** 视图/清单最近命中时间；null = 创建后无人访问。 */
  lastAccessAt: number | null;
}

export interface DesignShareComment {
  id: string;
  author: string;
  body: string;
  /** 元素定位载荷；null = 整页评论。 */
  target: DesignShareCommentTarget | null;
  createdAt: number;
  /** null = 未解决。 */
  resolvedAt: number | null;
}

/** 与桌面 DesignSelection.elementPath 同构：body 起的元素子节点序号。 */
export interface DesignShareCommentTarget {
  elementPath: number[];
  /** 小写标签名。 */
  tagName: string;
  /** 元素折叠空白后的文本（截 200）。 */
  text: string;
}

/** 公开清单（/s/:token/manifest.json）：不含 workspaceRoot/sessionId/token。 */
export interface DesignPublicShareManifest {
  title: string;
  entryPath: string;
  snapshotLabel: string | null;
  snapshotCreatedAt: number;
  complete: boolean;
  incompleteReasons: string[];
  files: Array<{ path: string; kind: string; bytes: number }>;
  shareCreatedAt: number;
  expiresAt: number | null;
}

// ---------------------------------------------------------------------------
// 上限与常量
// ---------------------------------------------------------------------------

export const SHARE_TITLE_MAX_LENGTH = 120;
export const SHARE_COMMENT_BODY_MAX_LENGTH = 4000;
export const SHARE_COMMENT_AUTHOR_MAX_LENGTH = 60;
export const SHARE_COMMENTS_PER_SHARE_LIMIT = 500;
export const SHARE_ELEMENT_PATH_MAX_DEPTH = 64;
export const SHARE_ELEMENT_PATH_MAX_INDEX = 9999;
export const SHARE_TARGET_TEXT_MAX_LENGTH = 200;
export const SHARE_TARGET_TAG_NAME_MAX_LENGTH = 40;
export const SHARE_EXPIRES_MIN_DAYS = 1;
export const SHARE_EXPIRES_MAX_DAYS = 365;
export const SHARE_FILE_PATH_MAX_LENGTH = 512;
export const SHARE_LIST_LIMIT = 100;
/** token = base64url(32 字节)，43 字符。 */
export const SHARE_TOKEN_BYTES = 32;

// ---------------------------------------------------------------------------
// 纯守卫
// ---------------------------------------------------------------------------

export function isDesignShareScope(value: unknown): value is DesignShareScope {
  return value === 'link' || value === 'local';
}
