// P7 S1 分享服务：分享生命周期（创建/列举/撤销）+ 公开侧 token 访问
// （清单 / 清单内文件 / 评论读写）。设计文档：
// docs/plans/2026-10-24-design-workbench-p7-implementation-plan.md §2。
// 契约类型与常量集中在 share-types.ts（冻结，禁改）；行为性实现全部落在本文件。

import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { BlobStore } from '../../infra/design/blob-store.js';
import { DesignError, DesignService } from './design-service.js';
import {
  isDesignShareScope,
  SHARE_COMMENT_AUTHOR_MAX_LENGTH,
  SHARE_COMMENT_BODY_MAX_LENGTH,
  SHARE_COMMENTS_PER_SHARE_LIMIT,
  SHARE_ELEMENT_PATH_MAX_DEPTH,
  SHARE_ELEMENT_PATH_MAX_INDEX,
  SHARE_EXPIRES_MAX_DAYS,
  SHARE_EXPIRES_MIN_DAYS,
  SHARE_FILE_PATH_MAX_LENGTH,
  SHARE_LIST_LIMIT,
  SHARE_TARGET_TAG_NAME_MAX_LENGTH,
  SHARE_TARGET_TEXT_MAX_LENGTH,
  SHARE_TITLE_MAX_LENGTH,
  SHARE_TOKEN_BYTES,
  type DesignPublicShareManifest,
  type DesignShareComment,
  type DesignShareCommentTarget,
  type DesignShareScope,
  type DesignShareSummary,
} from './share-types.js';

const DAY_MS = 86_400_000;
/** 评审者未自报姓名时的默认作者（§0：无账号体系，自报姓名）。 */
const DEFAULT_COMMENT_AUTHOR = '匿名';

/**
 * 公开侧统一入口：resolveByToken 的产物。share 携带 workspaceRoot（内部使用，
 * 不外发）；snapshot 取自 JOIN 的快照行（快照行必须仍在，否则视为未知 token）。
 */
export interface ShareAccess {
  share: DesignShareSummary & { workspaceRoot: string };
  snapshot: {
    id: string;
    entryPath: string;
    label: string | null;
    createdAt: number;
    complete: boolean;
    incompleteReasons: string[];
  };
}

interface ShareRow {
  id: string;
  workspace_root: string;
  session_id: string;
  snapshot_id: string;
  token: string;
  title: string | null;
  scope: string;
  created_at: number;
  expires_at: number | null;
  revoked_at: number | null;
  last_access_at: number | null;
  /** LEFT JOIN design_snapshots 所得；快照行被裁剪后为 ''。 */
  entry_path: string | null;
  comment_count: number;
}

interface ShareSnapshotJoinRow extends ShareRow {
  snapshot_label: string | null;
  snapshot_complete: number;
  snapshot_incomplete_reasons: string;
  snapshot_created_at: number;
}

interface CommentRow {
  id: string;
  share_id: string;
  author: string;
  body: string;
  target_json: string | null;
  created_at: number;
  resolved_at: number | null;
}

const commentCountSql = (alias: string): string =>
  `(SELECT COUNT(*) FROM design_share_comments WHERE share_id = ${alias}.id)`;

function toSummary(row: ShareRow): DesignShareSummary {
  return {
    id: row.id,
    token: row.token,
    snapshotId: row.snapshot_id,
    entryPath: row.entry_path ?? '',
    title: row.title,
    scope: isDesignShareScope(row.scope) ? row.scope : 'link',
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    commentCount: row.comment_count,
    lastAccessAt: row.last_access_at,
  };
}

/** target 形状守卫：elementPath 1..64 项整数 0..9999；tagName trim 1..40；text ≤200。 */
function isValidTarget(value: unknown): value is DesignShareCommentTarget {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.elementPath)) return false;
  if (candidate.elementPath.length < 1 || candidate.elementPath.length > SHARE_ELEMENT_PATH_MAX_DEPTH)
    return false;
  if (
    !candidate.elementPath.every(
      part => Number.isInteger(part) && part >= 0 && part <= SHARE_ELEMENT_PATH_MAX_INDEX
    )
  )
    return false;
  if (typeof candidate.tagName !== 'string') return false;
  const tagName = candidate.tagName.trim();
  if (!tagName || tagName.length > SHARE_TARGET_TAG_NAME_MAX_LENGTH) return false;
  if (typeof candidate.text !== 'string' || candidate.text.length > SHARE_TARGET_TEXT_MAX_LENGTH)
    return false;
  return true;
}

/** target_json 的反序列化只发生在本层；任何缺失/损坏都归一为 null。 */
function parseTarget(json: string | null): DesignShareCommentTarget | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    return isValidTarget(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function toComment(row: CommentRow): DesignShareComment {
  return {
    id: row.id,
    author: row.author,
    body: row.body,
    target: parseTarget(row.target_json),
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

function parseIncompleteReasons(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (Array.isArray(parsed))
      return parsed.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    /* fall through */
  }
  return [];
}

function requireObject(value: unknown, code: string, message: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new DesignError(400, code, message);
  return value as Record<string, unknown>;
}

function normalizeTitle(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string')
    throw new DesignError(400, 'SHARE_VALIDATION', 'title must be a string');
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > SHARE_TITLE_MAX_LENGTH)
    throw new DesignError(
      400,
      'SHARE_VALIDATION',
      `title must be at most ${SHARE_TITLE_MAX_LENGTH} characters`
    );
  return trimmed;
}

/** null/缺省 = 永不过期；否则整数 1..365 → 绝对过期时刻。 */
function expiresAtFromDays(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < SHARE_EXPIRES_MIN_DAYS ||
    value > SHARE_EXPIRES_MAX_DAYS
  )
    throw new DesignError(
      400,
      'SHARE_VALIDATION',
      `expiresInDays must be an integer between ${SHARE_EXPIRES_MIN_DAYS} and ${SHARE_EXPIRES_MAX_DAYS}`
    );
  return Date.now() + value * DAY_MS;
}

/**
 * SnapshotService 私有 manifest 路径守卫的同款语义（长度上限换成分享侧 512）：
 * 形状非法（非串/空/超长/含 \0）为 400；会离开清单的输入（反斜杠、posix 绝对、
 * `.`/`..`/点前缀/空组件）为 403；形状合法但不在清单内的路径稍后 404。
 */
function validateShareFilePath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > SHARE_FILE_PATH_MAX_LENGTH ||
    value.includes('\0')
  )
    throw new DesignError(400, 'VALIDATION_ERROR', 'path must be a relative file path');
  if (value.includes('\\') || path.posix.isAbsolute(value))
    throw new DesignError(403, 'PATH_FORBIDDEN', 'path is outside the share manifest');
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || part.startsWith('.')))
    throw new DesignError(403, 'PATH_FORBIDDEN', 'path is outside the share manifest');
  return value;
}

function normalizeCommentAuthor(value: unknown): string {
  if (value === undefined || value === null) return DEFAULT_COMMENT_AUTHOR;
  if (typeof value !== 'string')
    throw new DesignError(400, 'SHARE_COMMENT_INVALID', 'author must be a string');
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_COMMENT_AUTHOR;
  if (trimmed.length > SHARE_COMMENT_AUTHOR_MAX_LENGTH)
    throw new DesignError(
      400,
      'SHARE_COMMENT_INVALID',
      `author must be at most ${SHARE_COMMENT_AUTHOR_MAX_LENGTH} characters`
    );
  return trimmed;
}

function normalizeCommentBody(value: unknown): string {
  if (typeof value !== 'string')
    throw new DesignError(400, 'SHARE_COMMENT_INVALID', 'body must be a string');
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > SHARE_COMMENT_BODY_MAX_LENGTH)
    throw new DesignError(
      400,
      'SHARE_COMMENT_INVALID',
      `body must be 1 to ${SHARE_COMMENT_BODY_MAX_LENGTH} characters`
    );
  return trimmed;
}

function normalizeCommentTarget(value: unknown): DesignShareCommentTarget | null {
  if (value === undefined || value === null) return null;
  if (!isValidTarget(value))
    throw new DesignError(
      400,
      'SHARE_COMMENT_INVALID',
      'target must be { elementPath: number[], tagName: string, text: string }'
    );
  const candidate = value as DesignShareCommentTarget;
  return { elementPath: [...candidate.elementPath], tagName: candidate.tagName.trim(), text: candidate.text };
}

/** 清单标题的 basename 兜底（entryPath 为 posix 相对路径）。 */
function manifestTitle(entryPath: string): string {
  return path.posix.basename(entryPath) || entryPath;
}

export class ShareService {
  constructor(
    private readonly db: Database.Database,
    private readonly designService: DesignService,
    private readonly blobs: BlobStore
  ) {}

  // ---------------------------------------------------------------------------
  // 所有者侧（sessionId 鉴权）
  // ---------------------------------------------------------------------------

  async create(sessionId: unknown, input: unknown): Promise<DesignShareSummary> {
    const workspace = await this.designService.workspace(sessionId);
    const body = requireObject(input, 'SHARE_VALIDATION', 'input must be an object');

    const snapshotId = body.snapshotId;
    if (typeof snapshotId !== 'string' || !snapshotId)
      throw new DesignError(400, 'SHARE_VALIDATION', 'snapshotId must be a non-empty string');
    const snapshot = this.db
      .prepare('SELECT id, workspace_root, entry_path FROM design_snapshots WHERE id = ?')
      .get(snapshotId) as { id: string; workspace_root: string; entry_path: string } | undefined;
    if (!snapshot || snapshot.workspace_root !== workspace)
      throw new DesignError(404, 'SNAPSHOT_NOT_FOUND', 'Snapshot was not found');

    const scope: unknown = body.scope === undefined ? 'link' : body.scope;
    if (!isDesignShareScope(scope))
      throw new DesignError(400, 'SHARE_VALIDATION', "scope must be 'link' or 'local'");
    const expiresAt = expiresAtFromDays(body.expiresInDays);
    const title = normalizeTitle(body.title);

    const id = `sh${randomUUID()}`;
    const token = randomBytes(SHARE_TOKEN_BYTES).toString('base64url');
    const createdAt = Date.now();
    this.db
      .prepare(
        `INSERT INTO design_shares
         (id, workspace_root, session_id, snapshot_id, token, title, scope, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, workspace, sessionId as string, snapshot.id, token, title, scope, createdAt, expiresAt);
    return {
      id,
      token,
      snapshotId: snapshot.id,
      entryPath: snapshot.entry_path,
      title,
      scope,
      createdAt,
      expiresAt,
      revokedAt: null,
      commentCount: 0,
      lastAccessAt: null,
    };
  }

  /** 该工作区的全部分享（含已撤销），可按 entryPath（经快照 join）过滤。 */
  async list(sessionId: unknown, entryPath?: unknown): Promise<DesignShareSummary[]> {
    const workspace = await this.designService.workspace(sessionId);
    if (
      entryPath !== undefined &&
      entryPath !== null &&
      (typeof entryPath !== 'string' || !entryPath)
    )
      throw new DesignError(400, 'SHARE_VALIDATION', 'entryPath must be a non-empty string');
    const sql = (filter: string): string =>
      `SELECT sh.*, COALESCE(s.entry_path, '') AS entry_path,
              ${commentCountSql('sh')} AS comment_count
       FROM design_shares sh LEFT JOIN design_snapshots s ON s.id = sh.snapshot_id
       WHERE sh.workspace_root = ? ${filter}
       ORDER BY sh.created_at DESC, sh.rowid DESC LIMIT ?`;
    const rows = (
      entryPath
        ? this.db.prepare(sql('AND s.entry_path = ?')).all(workspace, entryPath, SHARE_LIST_LIMIT)
        : this.db.prepare(sql('')).all(workspace, SHARE_LIST_LIMIT)
    ) as ShareRow[];
    return rows.map(toSummary);
  }

  /** 撤销（内容保留、pin 继续）：归属不符 404；已撤销 409。 */
  async revoke(sessionId: unknown, shareId: unknown): Promise<DesignShareSummary> {
    const workspace = await this.designService.workspace(sessionId);
    const row = this.requireOwnedShare(workspace, shareId);
    if (row.revoked_at !== null)
      throw new DesignError(409, 'SHARE_ALREADY_REVOKED', 'Share has already been revoked');
    const revokedAt = Date.now();
    this.db.prepare('UPDATE design_shares SET revoked_at = ? WHERE id = ?').run(revokedAt, row.id);
    return { ...toSummary(row), revokedAt };
  }

  async listComments(sessionId: unknown, shareId: unknown): Promise<DesignShareComment[]> {
    const workspace = await this.designService.workspace(sessionId);
    const share = this.requireOwnedShare(workspace, shareId);
    return this.commentsOf(share.id);
  }

  /** 标记解决/取消解决。幂等：目标态已达成时直接返回当前行，不重写 resolved_at。 */
  async setResolved(
    sessionId: unknown,
    shareId: unknown,
    commentId: unknown,
    resolved: unknown
  ): Promise<DesignShareComment> {
    const workspace = await this.designService.workspace(sessionId);
    const share = this.requireOwnedShare(workspace, shareId);
    if (typeof resolved !== 'boolean')
      throw new DesignError(400, 'SHARE_VALIDATION', 'resolved must be a boolean');
    if (typeof commentId !== 'string' || !commentId)
      throw new DesignError(404, 'SHARE_COMMENT_NOT_FOUND', 'Comment was not found');
    const row = this.db
      .prepare('SELECT * FROM design_share_comments WHERE id = ? AND share_id = ?')
      .get(commentId, share.id) as CommentRow | undefined;
    if (!row) throw new DesignError(404, 'SHARE_COMMENT_NOT_FOUND', 'Comment was not found');
    const achieved = resolved ? row.resolved_at !== null : row.resolved_at === null;
    if (!achieved) {
      row.resolved_at = resolved ? Date.now() : null;
      this.db
        .prepare('UPDATE design_share_comments SET resolved_at = ? WHERE id = ?')
        .run(row.resolved_at, row.id);
    }
    return toComment(row);
  }

  // ---------------------------------------------------------------------------
  // 公开侧（token 即权限；scope 的网络属性判定在路由层）
  // ---------------------------------------------------------------------------

  async resolveByToken(token: unknown): Promise<ShareAccess> {
    if (typeof token !== 'string' || !token)
      throw new DesignError(404, 'SHARE_NOT_FOUND', 'Share was not found');
    const row = this.db
      .prepare(
        `SELECT sh.*, s.entry_path AS entry_path, s.label AS snapshot_label,
                s.complete AS snapshot_complete,
                s.incomplete_reasons AS snapshot_incomplete_reasons,
                s.created_at AS snapshot_created_at,
                ${commentCountSql('sh')} AS comment_count
         FROM design_shares sh JOIN design_snapshots s ON s.id = sh.snapshot_id
         WHERE sh.token = ?`
      )
      .get(token) as ShareSnapshotJoinRow | undefined;
    // 未知 token 与已撤销一律 404（不区分存在性）；快照行必须仍在。
    if (!row || row.revoked_at !== null)
      throw new DesignError(404, 'SHARE_NOT_FOUND', 'Share was not found');
    // expires_at null = 永不过期；到期（含恰好 now）即 410。
    if (row.expires_at !== null && row.expires_at <= Date.now())
      throw new DesignError(410, 'SHARE_EXPIRED', 'Share link has expired');
    return {
      share: { ...toSummary(row), workspaceRoot: row.workspace_root },
      snapshot: {
        id: row.snapshot_id,
        entryPath: row.entry_path ?? '',
        label: row.snapshot_label,
        createdAt: row.snapshot_created_at,
        complete: row.snapshot_complete === 1,
        incompleteReasons: parseIncompleteReasons(row.snapshot_incomplete_reasons),
      },
    };
  }

  async publicManifest(access: ShareAccess): Promise<DesignPublicShareManifest> {
    const files = this.db
      .prepare(
        'SELECT path, kind, bytes FROM design_snapshot_files WHERE snapshot_id = ? ORDER BY path'
      )
      .all(access.snapshot.id) as Array<{ path: string; kind: string; bytes: number }>;
    // 只有清单命中更新 last_access_at（文件/评论端点不更新，避免写放大）。
    const now = Date.now();
    this.db
      .prepare('UPDATE design_shares SET last_access_at = ? WHERE id = ?')
      .run(now, access.share.id);
    access.share.lastAccessAt = now;
    return {
      title: access.share.title ?? manifestTitle(access.share.entryPath),
      entryPath: access.snapshot.entryPath,
      snapshotLabel: access.snapshot.label,
      snapshotCreatedAt: access.snapshot.createdAt,
      complete: access.snapshot.complete,
      incompleteReasons: access.snapshot.incompleteReasons,
      files,
      shareCreatedAt: access.share.createdAt,
      expiresAt: access.share.expiresAt,
    };
  }

  async publicFile(
    access: ShareAccess,
    filePath: unknown
  ): Promise<{ mime: string; bytes: Buffer; sha256: string }> {
    const manifestPath = validateShareFilePath(filePath);
    const file = this.db
      .prepare('SELECT sha256, mime FROM design_snapshot_files WHERE snapshot_id = ? AND path = ?')
      .get(access.snapshot.id, manifestPath) as { sha256: string; mime: string | null } | undefined;
    if (!file) throw new DesignError(404, 'SHARE_FILE_NOT_FOUND', 'Path is not part of this share');
    const bytes = await this.blobs.readBlob(file.sha256);
    return { mime: file.mime ?? 'application/octet-stream', bytes, sha256: file.sha256 };
  }

  async addComment(access: ShareAccess, input: unknown): Promise<DesignShareComment> {
    const body = requireObject(input, 'SHARE_COMMENT_INVALID', 'input must be an object');
    const author = normalizeCommentAuthor(body.author);
    const text = normalizeCommentBody(body.body);
    const target = normalizeCommentTarget(body.target);

    const { count } = this.db
      .prepare('SELECT COUNT(*) AS count FROM design_share_comments WHERE share_id = ?')
      .get(access.share.id) as { count: number };
    if (count >= SHARE_COMMENTS_PER_SHARE_LIMIT)
      throw new DesignError(
        400,
        'SHARE_COMMENT_LIMIT',
        `This share has reached the limit of ${SHARE_COMMENTS_PER_SHARE_LIMIT} comments`
      );

    const id = `sc${randomUUID()}`;
    const createdAt = Date.now();
    this.db
      .prepare(
        `INSERT INTO design_share_comments (id, share_id, author, body, target_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        access.share.id,
        author,
        text,
        target === null ? null : JSON.stringify(target),
        createdAt
      );
    return { id, author, body: text, target, createdAt, resolvedAt: null };
  }

  async publicComments(access: ShareAccess): Promise<DesignShareComment[]> {
    return this.commentsOf(access.share.id);
  }

  // ---------------------------------------------------------------------------
  // 内部
  // ---------------------------------------------------------------------------

  /** 所有者侧归属校验：shareId 形状、行存在性与 workspace_root 归属，不符一律 404。 */
  private requireOwnedShare(workspace: string, shareId: unknown): ShareRow {
    if (typeof shareId !== 'string' || !shareId)
      throw new DesignError(404, 'SHARE_NOT_FOUND', 'Share was not found');
    const row = this.db
      .prepare(
        `SELECT sh.*, COALESCE(s.entry_path, '') AS entry_path,
                ${commentCountSql('sh')} AS comment_count
         FROM design_shares sh LEFT JOIN design_snapshots s ON s.id = sh.snapshot_id
         WHERE sh.id = ?`
      )
      .get(shareId) as ShareRow | undefined;
    if (!row || row.workspace_root !== workspace)
      throw new DesignError(404, 'SHARE_NOT_FOUND', 'Share was not found');
    return row;
  }

  private commentsOf(shareId: string): DesignShareComment[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM design_share_comments WHERE share_id = ? ORDER BY created_at ASC, rowid ASC'
      )
      .all(shareId) as CommentRow[];
    return rows.map(toComment);
  }
}
