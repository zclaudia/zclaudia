// P7 S2 分享视图路由：公开侧（/s/:token）五端点 + 自包含视图 HTML。
// 设计文档：docs/plans/2026-10-24-design-workbench-p7-implementation-plan.md §4。
// token 即权限（无会话鉴权）；scope === 'local' 的网络属性判定在本层完成。

import { Router, type Request, type Response } from 'express';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { resolveDataDir } from '../../infra/storage/db.js';
import { BlobStore } from '../../infra/design/blob-store.js';
import { DesignError, DesignService } from '../../application/design/design-service.js';
import { ShareService, type ShareAccess } from '../../application/design/share-service.js';
import { sendApiError } from '../../utils/http-response.js';

// ---------------------------------------------------------------------------
// 视图 HTML（§4.2）：完全静态的模板字符串——内联 JS 不含 `${` 与反引号，
// token/路径一律从 location.pathname 运行时解析，绝不进模板。
// ---------------------------------------------------------------------------

export const SHARE_VIEWER_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Design share</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; background: #f5f6f8; color: #1f2328; height: 100vh; display: flex; flex-direction: column; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 10px 16px; background: #fff; border-bottom: 1px solid #e4e7ec; flex: none; }
  #title { font-size: 16px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #subline { font-size: 12px; color: #6b7280; margin-top: 2px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .badge { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; }
  .badge-ok { background: #ecfdf3; color: #067647; border: 1px solid #abefc6; } .badge-warn { background: #fffaeb; color: #b54708; border: 1px solid #fedf89; }
  .badge-done { background: #eff8ff; color: #175cd3; border: 1px solid #b2ddff; }
  #expireNote { font-size: 12px; color: #b42318; margin-top: 2px; }
  .name-box { font-size: 12px; color: #6b7280; flex: none; }
  .name-box input { margin-left: 6px; padding: 5px 8px; border: 1px solid #d0d5dd; border-radius: 6px; font-size: 13px; width: 140px; }
  main { flex: 1; display: flex; min-height: 0; }
  .stage { flex: 1; min-width: 0; padding: 12px; }
  iframe { width: 100%; height: 100%; border: 1px solid #e4e7ec; border-radius: 8px; background: #fff; }
  .comments { width: 340px; flex: none; background: #fff; border-left: 1px solid #e4e7ec; display: flex; flex-direction: column; padding: 12px; gap: 10px; overflow: hidden; }
  .comments h2 { font-size: 14px; color: #1f2328; }
  #commentList { list-style: none; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 8px; }
  #commentList li { border: 1px solid #e4e7ec; border-radius: 8px; padding: 8px 10px; font-size: 13px; }
  .c-head { display: flex; align-items: center; gap: 8px; color: #6b7280; font-size: 12px; }
  .c-author { font-weight: 600; color: #1f2328; }
  .c-body { margin-top: 4px; white-space: pre-wrap; word-break: break-word; }
  .chip { margin-top: 6px; display: inline-block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: #f2f4f7; border: 1px solid #d0d5dd; border-radius: 6px; padding: 2px 8px; font-size: 12px; color: #175cd3; cursor: pointer; }
  .chip-dead { color: #b42318; cursor: default; }
  .empty { color: #98a2b3; font-size: 13px; padding: 8px 2px; }
  form { border-top: 1px solid #e4e7ec; padding-top: 10px; display: flex; flex-direction: column; gap: 8px; flex: none; }
  #targetSummary { display: flex; align-items: center; justify-content: space-between; gap: 8px; background: #f2f4f7; border-radius: 6px; padding: 6px 8px; font-size: 12px; color: #1f2328; }
  #targetText { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #clearTarget { flex: none; border: none; background: none; color: #175cd3; font-size: 12px; cursor: pointer; }
  textarea { width: 100%; min-height: 64px; resize: vertical; border: 1px solid #d0d5dd; border-radius: 6px; padding: 8px; font-size: 13px; font-family: inherit; }
  form button[type=submit] { align-self: flex-end; background: #4f46e5; color: #fff; border: none; border-radius: 6px; padding: 7px 16px; font-size: 13px; cursor: pointer; }
  #formMessage { font-size: 12px; color: #b42318; }
  #toast { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); max-width: 80%; font-size: 13px; background: rgba(31, 35, 40, 0.92); color: #fff; border-radius: 8px; padding: 8px 14px; }
  .hidden { display: none !important; }
</style>
</head>
<body>
<header>
  <div style="min-width:0">
    <div id="title">Loading…</div>
    <div id="subline"><span id="snapMeta"></span><span id="completeBadge" class="badge hidden"></span></div>
    <div id="expireNote" class="hidden"></div>
  </div>
  <label class="name-box">Name (optional)<input id="authorName" placeholder="Anonymous" maxlength="60"></label>
</header>
<main>
  <section class="stage">
    <iframe id="stageFrame" title="Shared page preview" sandbox="allow-same-origin"></iframe>
  </section>
  <aside class="comments">
    <h2>Comments (<span id="commentCount">0</span>)</h2>
    <ul id="commentList"><li class="empty">Loading…</li></ul>
    <form id="commentForm">
      <div id="targetSummary" class="hidden">
        <span id="targetText"></span>
        <button type="button" id="clearTarget">Clear anchor (comment on the whole page)</button>
      </div>
      <textarea id="commentBody" placeholder="Write your review feedback…" required></textarea>
      <button type="submit">Post comment</button>
      <p id="formMessage" class="hidden"></p>
    </form>
  </aside>
</main>
<div id="toast" class="hidden"></div>
<script>
(function () {
  'use strict';
  // token 不进模板：一律从当前地址解析（/s/<token>）。
  var base = location.pathname.replace(/\\/+$/, '');
  var frame = document.getElementById('stageFrame');
  var frameDoc = null;
  var currentTarget = null;
  var highlighted = null;
  var toastTimer = null;

  function $(id) { return document.getElementById(id); }
  function formatTime(ts) { return new Date(ts).toLocaleString('zh-CN', { hour12: false }); }
  function collapse(text) { return String(text || '').replace(/\\s+/g, ' ').trim(); }

  function toast(message) {
    var node = $('toast');
    node.textContent = message;
    node.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.classList.add('hidden'); }, 3200);
  }

  function showFormError(message) {
    var node = $('formMessage');
    node.textContent = message;
    node.classList.remove('hidden');
  }

  function clearFormError() { $('formMessage').classList.add('hidden'); }

  // ---- 元素定位：elementPath = 自 body 起按元素子节点序号 ----

  function elementPathOf(el) {
    var path = [];
    var node = el;
    if (!el || !frameDoc || el === frameDoc.body) return path;
    for (;;) {
      var parent = node.parentElement;
      if (!parent) return [];
      path.unshift(Array.prototype.indexOf.call(parent.children, node));
      if (parent === frameDoc.body) return path;
      node = parent;
    }
  }

  function resolveElement(path) {
    if (!frameDoc || !frameDoc.body) return null;
    var node = frameDoc.body;
    for (var i = 0; i < path.length; i++) {
      node = node.children[path[i]] || null;
      if (!node) return null;
    }
    return node;
  }

  function highlight(el) {
    if (highlighted) {
      highlighted.style.outline = '';
      highlighted.style.outlineOffset = '';
    }
    highlighted = el;
    if (el) {
      el.style.outline = '2px solid #4f46e5';
      el.style.outlineOffset = '2px';
    }
  }

  function clearTarget() {
    currentTarget = null;
    highlight(null);
    $('targetSummary').classList.add('hidden');
  }

  function targetLabel(target, limit) {
    var text = collapse(target.text).slice(0, limit);
    return 'Anchor: ' + target.tagName + (text ? ' ' + text : '(no text)');
  }

  function selectElement(el) {
    var path = elementPathOf(el);
    if (!path.length) { clearTarget(); return; }
    var text = collapse(el.textContent).slice(0, 200);
    currentTarget = { elementPath: path, tagName: el.tagName.toLowerCase(), text: text };
    highlight(el);
    $('targetText').textContent = targetLabel(currentTarget, 40);
    $('targetSummary').classList.remove('hidden');
  }

  frame.addEventListener('load', function () {
    var doc = frame.contentDocument;
    if (!doc) return;
    frameDoc = doc;
    // 捕获阶段拦截一切点击：禁导航/表单，元素点击转为评论定位。
    doc.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      var node = event.target;
      if (node && node.closest) {
        var link = node.closest('a');
        if (link) toast('Shared as a static snapshot; link navigation is disabled: ' + link.href);
      }
      if (node && node.nodeType === 1) selectElement(node);
    }, true);
  });

  // ---- 评论列表 ----

  function markChipDead(chip) {
    chip.classList.add('chip-dead');
    chip.textContent = 'Anchor lost';
  }

  function commentItem(comment) {
    var li = document.createElement('li');
    var head = document.createElement('div');
    head.className = 'c-head';
    var author = document.createElement('span');
    author.className = 'c-author';
    author.textContent = comment.author;
    head.appendChild(author);
    var time = document.createElement('span');
    time.textContent = formatTime(comment.createdAt);
    head.appendChild(time);
    if (comment.resolvedAt !== null && comment.resolvedAt !== undefined) {
      var done = document.createElement('span');
      done.className = 'badge badge-done';
      done.textContent = 'Resolved';
      head.appendChild(done);
    }
    li.appendChild(head);
    var body = document.createElement('div');
    body.className = 'c-body';
    body.textContent = comment.body;
    li.appendChild(body);
    if (comment.target) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = targetLabel(comment.target, 40);
      chip.addEventListener('click', function () {
        var el = resolveElement(comment.target.elementPath);
        if (!el) { markChipDead(chip); return; }
        highlight(el);
      });
      li.appendChild(chip);
    }
    return li;
  }

  function refreshComments() {
    return fetch(base + '/comments').then(function (res) {
      if (!res.ok) throw new Error('Failed to load comments (HTTP ' + res.status + ')');
      return res.json();
    }).then(function (payload) {
      var comments = payload.comments || [];
      var list = $('commentList');
      $('commentCount').textContent = String(comments.length);
      list.textContent = '';
      if (!comments.length) {
        var empty = document.createElement('li');
        empty.className = 'empty';
        empty.textContent = 'No comments yet — be the first.';
        list.appendChild(empty);
        return;
      }
      comments.forEach(function (comment) { list.appendChild(commentItem(comment)); });
    });
  }

  // ---- 清单与初始化 ----

  function applyManifest(manifest) {
    document.title = manifest.title + ' · Design share';
    $('title').textContent = manifest.title;
    var meta = manifest.snapshotLabel
      ? 'Snapshot: ' + manifest.snapshotLabel + ' · ' + formatTime(manifest.snapshotCreatedAt)
      : 'Snapshot time: ' + formatTime(manifest.snapshotCreatedAt);
    $('snapMeta').textContent = meta;
    var badge = $('completeBadge');
    if (manifest.complete) {
      badge.textContent = 'Complete';
      badge.className = 'badge badge-ok';
    } else {
      badge.textContent = 'Incomplete: ' + (manifest.incompleteReasons || []).join(', ');
      badge.className = 'badge badge-warn';
    }
    badge.classList.remove('hidden');
    if (manifest.expiresAt !== null && manifest.expiresAt !== undefined) {
      $('expireNote').textContent = 'The link expires at ' + formatTime(manifest.expiresAt);
      $('expireNote').classList.remove('hidden');
    }
    frame.src = base + '/f/' + manifest.entryPath.split('/').map(encodeURIComponent).join('/');
  }

  var nameInput = $('authorName');
  try { nameInput.value = localStorage.getItem('zclaudia-share-name') || ''; } catch (err) { /* 隐私模式忽略 */ }
  nameInput.addEventListener('input', function () {
    try { localStorage.setItem('zclaudia-share-name', nameInput.value); } catch (err) { /* 同上 */ }
  });

  $('clearTarget').addEventListener('click', clearTarget);

  $('commentForm').addEventListener('submit', function (event) {
    event.preventDefault();
    var text = $('commentBody').value.trim();
    if (!text) return;
    clearFormError();
    fetch(base + '/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author: nameInput.value, body: text, target: currentTarget })
    }).then(function (res) {
      return res.json().then(function (payload) { return { ok: res.ok, payload: payload }; });
    }).then(function (result) {
      if (!result.ok || !result.payload.comment) {
        showFormError((result.payload.error && result.payload.error.message) || 'Failed to post; try again');
        return;
      }
      $('commentBody').value = '';
      refreshComments().catch(function (err) { showFormError(err.message); });
    }).catch(function () { showFormError('Failed to post; check your network and try again'); });
  });

  fetch(base + '/manifest.json').then(function (res) {
    if (!res.ok) throw new Error('Failed to load the manifest (HTTP ' + res.status + ')');
    return res.json();
  }).then(function (manifest) {
    applyManifest(manifest);
    return refreshComments();
  }).catch(function (err) {
    $('title').textContent = 'Failed to load the share view';
    showFormError(err.message);
  });
})();
</script>
</body>
</html>
`;

// ---------------------------------------------------------------------------
// 路由（§4 表格）：全部无会话鉴权，token 即权限。
// ---------------------------------------------------------------------------

/** /f/* 与入口 HTML 的统一响应 CSP（default-src 'none' 封死脚本；unsafe-inline 供页内样式）。 */
const SHARE_FILE_CSP =
  "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; media-src 'self'";

/** 可注入依赖：isLocal 替代真实本机判定（测试模拟非本机请求）。 */
export interface DesignShareRoutesDeps {
  isLocal?: (req: Request) => boolean;
}

/** 真实本机判定：middleware/local-only.ts 的 isLocalhost 同款三态。 */
function defaultIsLocal(req: Request): boolean {
  const ip = req.socket.remoteAddress;
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

/** 错误信封：DesignError 按 §2.3 映射；其余一律 500 INTERNAL_ERROR 兜底。 */
function sendError(res: Response, error: unknown): void {
  if (error instanceof DesignError) {
    sendApiError(res, error.status, error.code, error.message);
  } else {
    sendApiError(res, 500, 'INTERNAL_ERROR', 'Design request failed');
  }
}

export function createDesignShareRoutes(
  db: Database.Database,
  deps?: DesignShareRoutesDeps
): Router {
  const router = Router();
  // 与 interfaces/http/design.ts 同款装配（blob 根 = resolveDataDir()/design-snapshots）。
  const shares = new ShareService(
    db,
    new DesignService(db),
    new BlobStore(path.join(resolveDataDir(), 'design-snapshots'))
  );
  const isLocal = deps?.isLocal ?? defaultIsLocal;

  /** 统一入口：token 解析 + local 范围的网络属性判定（服务层不管网络，§2.2）。 */
  const resolveAccess = async (req: Request): Promise<ShareAccess> => {
    const access = await shares.resolveByToken(req.params.token);
    if (access.share.scope === 'local' && !isLocal(req)) {
      throw new DesignError(403, 'SHARE_LOCAL_ONLY', 'This share is only accessible from this machine');
    }
    return access;
  };

  // 视图 HTML：无外链资源、无框架；token 从 location.pathname 由内联 JS 解析。
  router.get('/s/:token', async (req: Request, res: Response) => {
    try {
      await resolveAccess(req);
      res.set('Content-Type', 'text/html; charset=utf-8');
      res.set('Cache-Control', 'no-store');
      res.send(SHARE_VIEWER_HTML);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/s/:token/manifest.json', async (req: Request, res: Response) => {
    try {
      const access = await resolveAccess(req);
      res.json(await shares.publicManifest(access));
    } catch (error) {
      sendError(res, error);
    }
  });

  // 清单内文件：路径取通配段，逐段 decode 再 join（清单路径为唯一真源）。
  router.get('/s/:token/f/*', async (req: Request, res: Response) => {
    try {
      const access = await resolveAccess(req);
      const wildcard = typeof req.params[0] === 'string' ? req.params[0] : '';
      const filePath = wildcard
        .split('/')
        .map(part => {
          try {
            return decodeURIComponent(part);
          } catch {
            // 非法百分号编码不可能命中清单。
            throw new DesignError(404, 'SHARE_FILE_NOT_FOUND', 'Path is not part of this share');
          }
        })
        .join('/');
      const file = await shares.publicFile(access, filePath);
      res.set('Content-Type', file.mime);
      res.set('X-Content-Type-Options', 'nosniff');
      res.set('Cache-Control', 'private, no-store');
      res.set('Content-Security-Policy', SHARE_FILE_CSP);
      res.send(file.bytes);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/s/:token/comments', async (req: Request, res: Response) => {
    try {
      const access = await resolveAccess(req);
      res.json({ comments: await shares.publicComments(access) });
    } catch (error) {
      sendError(res, error);
    }
  });

  // body JSON 由宿主全局 express.json 解析（server.ts）；此处只透传 req.body。
  router.post('/s/:token/comments', async (req: Request, res: Response) => {
    try {
      const access = await resolveAccess(req);
      const comment = await shares.addComment(access, req.body ?? {});
      res.status(201).json({ comment });
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}
