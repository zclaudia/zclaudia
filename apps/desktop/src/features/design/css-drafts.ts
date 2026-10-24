/**
 * P3.5 第二批（C6）：外部 `.css` 文件的进程内 per-file 草稿表（§6）。
 *
 * 模式对齐 workspace 层：以 workspace identity（workspaceIdentityKey 同款哈希）
 * + css 路径为键，进程内跨面板开关/会话切换存活（同 identity 复用；不持久化、
 * 不淘汰——v1 口径，面板卸载后草稿仍占内存）。每文件
 * { source, baseRevision, dirty, history（有界，尺寸/合并窗口同 controller 的
 * HISTORY_OPTIONS）, draftEpoch }；工作区级 cssDraftEpoch 在任一文件草稿变化时
 * 自增，供 DesignPanel 的预览缓存键。
 *
 * 组件边界：磁盘读取（api getDesignDocument(.css)）与保存（putDesignDocument）
 * 由组件层异步完成，本模块只存与补丁——applyCssEdit 内部走 css-source.patchCssText，
 * 与 edit-engine 的 `<style>` 块 splice 共用同一偏移引擎，逐字节无关保持。
 */
import { patchCssText } from './css-source';
import type { CssSourceEdit } from './css-source';
import { EditHistory } from './history/edit-history';
import { sha256HexSync } from './html/hash';
import { DesignEditError } from './types';
import { workspaceIdentityKey } from './workspace/controller';

/** 工作区 identity（与 workspace controller registry 同构；workspaceIdentityKey 归一）。 */
export interface CssDraftIdentity {
  backendId: string;
  projectId?: string;
  workingDirectory?: string;
}

/** 单条 CSS 草稿的可观测状态（getCssDraft / 草稿表快照的行）。 */
export interface CssDraftStatus {
  path: string;
  /** 当前草稿全文（干净时等于基线源码）。 */
  source: string;
  /** sha256(source)（同步引擎，与 sha256Hex 同值）。 */
  revision: string;
  /** 最近已知磁盘修订。 */
  baseRevision: string;
  dirty: boolean;
  /** 每文件单调递增（每次 apply 自增）。 */
  draftEpoch: number;
}

/** 一个工作区的草稿表快照（引用稳定；任一变更换新对象，useSyncExternalStore 消费）。 */
export interface CssDraftTableSnapshot {
  /** 全局单调计数（任一工作区变更自增）。 */
  version: number;
  /** 工作区级 cssDraftEpoch：任一文件草稿变化（apply/采纳/丢弃）自增；预览缓存键用。 */
  epoch: number;
  /** path → 草稿状态。 */
  drafts: Record<string, CssDraftStatus>;
}

/** 与 workspace/controller.ts 的 HISTORY_OPTIONS 同尺寸与合并窗口（卡片契约）。 */
const HISTORY_OPTIONS = { limit: 100, maxBytes: 8 * 1024 * 1024, mergeWindowMs: 1500 };

interface DraftRecord {
  source: string;
  revision: string;
  /** 打开/最近一次提交时的基线源码（dirty 判定基准）。 */
  baseSource: string;
  baseRevision: string;
  history: EditHistory;
  draftEpoch: number;
}

interface WorkspaceDrafts {
  drafts: Map<string, DraftRecord>;
  epoch: number;
  snapshot: CssDraftTableSnapshot;
}

const workspaces = new Map<string, WorkspaceDrafts>();
const listeners = new Set<() => void>();
let versionCounter = 0;

const identityKeyOf = (identity: CssDraftIdentity): string => workspaceIdentityKey(identity);

function workspaceOf(identity: CssDraftIdentity): WorkspaceDrafts {
  const key = identityKeyOf(identity);
  let ws = workspaces.get(key);
  if (!ws) {
    ws = { drafts: new Map(), epoch: 0, snapshot: { version: 0, epoch: 0, drafts: {} } };
    workspaces.set(key, ws);
  }
  return ws;
}

function statusOf(path: string, record: DraftRecord): CssDraftStatus {
  return {
    path,
    source: record.source,
    revision: record.revision,
    baseRevision: record.baseRevision,
    dirty: record.source !== record.baseSource,
    draftEpoch: record.draftEpoch,
  };
}

function notify(key: string): void {
  const ws = workspaces.get(key);
  if (ws) ws.snapshot = { version: ++versionCounter, epoch: ws.epoch, drafts: snapshotDrafts(ws) };
  for (const listener of [...listeners]) listener();
}

function snapshotDrafts(ws: WorkspaceDrafts): Record<string, CssDraftStatus> {
  const drafts: Record<string, CssDraftStatus> = {};
  for (const [path, record] of ws.drafts) drafts[path] = statusOf(path, record);
  return drafts;
}

/** 订阅任一工作区的草稿表变化（DesignPanel 经 useSyncExternalStore 消费）。 */
export function subscribeCssDrafts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 当前工作区的草稿表快照；引用稳定，仅任一变化时更换对象。 */
export function getCssDraftTable(identity: CssDraftIdentity): CssDraftTableSnapshot {
  return workspaceOf(identity).snapshot;
}

/**
 * 打开（或复用）一个 css 文件的进程内草稿。doc 为组件层取回的磁盘文档：
 * 首次打开以 doc 建立基线；已打开且基线修订一致 → 原样返回；干净草稿遇磁盘
 * 变化 → 无条件采纳新文档（等同重新载入）；脏草稿 → 保留（磁盘变化由保存
 * 409 冲突路径呈现，绝不静默丢弃用户编辑）。
 */
export function openCssDraft(
  identity: CssDraftIdentity,
  path: string,
  doc: { source: string; revision: string }
): CssDraftStatus {
  const key = identityKeyOf(identity);
  const ws = workspaceOf(identity);
  const existing = ws.drafts.get(path);
  if (!existing) {
    const record: DraftRecord = {
      source: doc.source,
      revision: sha256HexSync(doc.source),
      baseSource: doc.source,
      baseRevision: doc.revision,
      history: new EditHistory({ ...HISTORY_OPTIONS }),
      draftEpoch: 0,
    };
    ws.drafts.set(path, record);
    notify(key);
    return statusOf(path, record);
  }
  if (existing.baseRevision !== doc.revision && existing.source === existing.baseSource) {
    // 干净草稿且磁盘已变化：无条件采纳新文档（等同重新载入）。
    existing.source = doc.source;
    existing.revision = sha256HexSync(doc.source);
    existing.baseSource = doc.source;
    existing.baseRevision = doc.revision;
    existing.history.rebuild(doc.source);
    ws.epoch += 1;
    notify(key);
  }
  // 脏草稿：保留（磁盘变化由保存 409 冲突路径呈现，绝不静默丢弃用户编辑）。
  return statusOf(path, existing);
}

/** 当前草稿状态；未打开返回 null。 */
export function getCssDraft(identity: CssDraftIdentity, path: string): CssDraftStatus | null {
  const record = workspaceOf(identity).drafts.get(path);
  return record ? statusOf(path, record) : null;
}

/** 所有脏草稿的路径（保存逐文件提交的清单）。 */
export function dirtyCssPaths(identity: CssDraftIdentity): string[] {
  const paths: string[] = [];
  for (const [path, record] of workspaceOf(identity).drafts) {
    if (record.source !== record.baseSource) paths.push(path);
  }
  return paths;
}

/** 工作区级 cssDraftEpoch（预览缓存键用；与快照.epoch 同值）。 */
export function cssDraftEpoch(identity: CssDraftIdentity): number {
  return workspaceOf(identity).epoch;
}

/**
 * 对草稿应用一条声明编辑（与 styleBlock op 同字段减去 styleOrdinal）。
 * baseRevision 须等于草稿当前修订（防陈旧并发写）；补丁经 patchCssText 与
 * edit-engine 同口径逐字节保持。成功后 dirty、draftEpoch 与工作区 cssDraftEpoch
 * 自增，并记录有界历史（同键合并窗口内折叠为一条撤销记录）。
 */
export function applyCssEdit(
  identity: CssDraftIdentity,
  path: string,
  baseRevision: string,
  edit: CssSourceEdit
): { source: string; revision: string } {
  const key = identityKeyOf(identity);
  const record = workspaceOf(identity).drafts.get(path);
  if (!record) {
    throw new Error(`The style draft for ${path} is not open; reopen the style sources panel.`);
  }
  if (baseRevision !== record.revision) {
    throw new DesignEditError(
      'REVISION_MISMATCH',
      'The style draft changed since the edit was prepared; try again.'
    );
  }
  const before = record.source;
  const next = patchCssText(before, edit);
  if (next === before) {
    throw new DesignEditError('EMPTY_TRANSACTION', 'No changes to apply');
  }
  const revision = sha256HexSync(next);
  record.source = next;
  record.revision = revision;
  record.draftEpoch += 1;
  const ws = workspaceOf(identity);
  ws.epoch += 1;
  record.history.record({
    before,
    after: next,
    label: `Edit style source ${path}`,
    at: Date.now(),
    mergeKey: `css:${edit.rulePath.join('.')}:${edit.property.toLowerCase()}`,
  });
  notify(key);
  return { source: next, revision };
}

/** 撤销最近一条记录（同 controller.moveHistory 语义；无可撤销或基线漂移返回 false）。 */
export function undoCssDraft(identity: CssDraftIdentity, path: string): boolean {
  return moveCssDraftHistory(identity, path, 'undo');
}

/** 重做最近一条被撤销的记录（对称防御，无可重做返回 false）。 */
export function redoCssDraft(identity: CssDraftIdentity, path: string): boolean {
  return moveCssDraftHistory(identity, path, 'redo');
}

function moveCssDraftHistory(
  identity: CssDraftIdentity,
  path: string,
  direction: 'undo' | 'redo'
): boolean {
  const key = identityKeyOf(identity);
  const ws = workspaceOf(identity);
  const record = ws.drafts.get(path);
  if (!record) return false;
  const next = direction === 'undo' ? record.history.undo(record.source) : record.history.redo(record.source);
  if (next === null) return false; // EditHistory 已在基线漂移时自重建
  record.source = next;
  record.revision = sha256HexSync(next);
  record.draftEpoch += 1;
  ws.epoch += 1;
  notify(key);
  return true;
}

/**
 * 保存成功回写：清 dirty、更新基线源码与 baseRevision（历史保留，草稿在保存后
 * 仍可撤销）。不改 epoch——保存不改变预览内容（磁盘版与草稿一致）。
 */
export function commitCssDraft(
  identity: CssDraftIdentity,
  path: string,
  saved: { source: string; revision: string }
): void {
  const key = identityKeyOf(identity);
  const record = workspaceOf(identity).drafts.get(path);
  if (!record) return;
  record.source = saved.source;
  record.revision = saved.revision;
  record.baseSource = saved.source;
  record.baseRevision = saved.revision;
  record.history.markSaved(saved.source);
  notify(key);
}

/**
 * 丢弃草稿（reload 口径）：删除记录并由组件层重取磁盘文档后重新 openCssDraft。
 * epoch 自增——预览需从草稿内联回退到磁盘版。
 */
export function discardCssDraft(identity: CssDraftIdentity, path: string): void {
  const key = identityKeyOf(identity);
  const ws = workspaceOf(identity);
  if (!ws.drafts.delete(path)) return;
  ws.epoch += 1;
  notify(key);
}

/** 清空草稿表（identity 缺省 = 全部工作区）；测试隔离与显式重置用。 */
export function discardAllCssDrafts(identity?: CssDraftIdentity): void {
  if (identity) {
    const key = identityKeyOf(identity);
    const ws = workspaces.get(key);
    if (!ws || ws.drafts.size === 0) return;
    ws.drafts.clear();
    ws.epoch += 1;
    notify(key);
    return;
  }
  for (const [key, ws] of workspaces) {
    if (ws.drafts.size === 0) continue;
    ws.drafts.clear();
    ws.epoch += 1;
    notify(key);
  }
}

/**
 * UTF-8 文本 → base64（preview.decodeBase64Utf8 的逆）。预览 loadAsset 草稿内联
 * 需要与 getDesignAsset 相同的载荷形态（mime + base64 data）。
 */
export function encodeBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
