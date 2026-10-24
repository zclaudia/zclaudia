/** P5.2 交互运行预览：构建可执行页面的沙箱 srcdoc。本地脚本内联执行、on* 保留；远程引用移除并计数；导航经桥接上报宿主。 */
import {
  createAssetInlineLoader,
  decodeBase64Utf8,
  inlineStyleSources,
  workspaceSourceDir,
} from './preview';

/** 运行模式脚本内联上限：本地脚本数、单脚本与总内联体积，超限移除并计入 blocked.scripts。 */
const MAX_RUN_SCRIPTS = 12;
const MAX_RUN_SCRIPT_BYTES = 512 * 1024;
const MAX_RUN_TOTAL_SCRIPT_BYTES = 2 * 1024 * 1024;

/** 远程引用（scheme 或 // 开头）判定，构建期分类与桥接运行期分类同口径。 */
const REMOTE_REFERENCE = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;

/** 运行模式 CSP：与编辑模式差异仅 script-src 一项（'unsafe-inline' data: blob:，无 nonce）。 */
const RUN_CSP =
  "default-src 'none'; img-src data: blob:; media-src data: blob:; font-src data:; style-src 'unsafe-inline' data:; script-src 'unsafe-inline' data: blob:; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";

export interface RunPreviewOptions {
  source: string;
  /** 工作区相对路径（相对链接解析基准）。 */
  filePath: string;
  loadAsset: (relativeWorkspacePath: string) => Promise<{ mimeType: string; data: string }>;
  channel: string;
}

export interface RunPreviewResult {
  html: string;
  /** 构建期被移除的远程引用计数（状态行展示）。 */
  blocked: { scripts: number; links: number };
}

export async function buildDesignRunPreview(options: RunPreviewOptions): Promise<RunPreviewResult> {
  const { source, filePath, loadAsset, channel } = options;
  const doc = new DOMParser().parseFromString(source, 'text/html');
  doc.querySelectorAll('base, object, embed, iframe, meta[http-equiv]').forEach(node => {
    if (
      node.tagName.toLowerCase() !== 'meta' ||
      ['refresh', 'content-security-policy'].includes(
        (node.getAttribute('http-equiv') ?? '').toLowerCase()
      )
    ) {
      node.remove();
    }
  });

  const sourceDir = workspaceSourceDir(filePath);
  const loader = createAssetInlineLoader(loadAsset);
  const blocked = { scripts: 0, links: 0 };
  let inlinedScripts = 0;
  let totalScriptBytes = 0;

  // 脚本：无 src 的内联脚本原样保留；远程 src 移除并计数；相对 src 经 loadAsset 读取（UTF-8 解码）内联。
  for (const script of Array.from(doc.querySelectorAll('script'))) {
    const src = script.getAttribute('src');
    if (src === null) continue;
    if (REMOTE_REFERENCE.test(src) || inlinedScripts >= MAX_RUN_SCRIPTS) {
      script.remove();
      blocked.scripts += 1;
      continue;
    }
    try {
      const asset = await loadAsset(resolveWorkspaceRef(src, sourceDir));
      const bytes = Math.ceil((asset.data.length * 3) / 4);
      if (bytes > MAX_RUN_SCRIPT_BYTES || totalScriptBytes + bytes > MAX_RUN_TOTAL_SCRIPT_BYTES)
        throw new Error('run-script-too-large');
      totalScriptBytes += bytes;
      inlinedScripts += 1;
      script.removeAttribute('src');
      script.textContent = decodeBase64Utf8(asset.data);
    } catch {
      script.remove();
      blocked.scripts += 1;
    }
  }

  // 图片/srcset/样式内联：与静态预览同一 loader、同一规则与上限。
  for (const image of Array.from(doc.querySelectorAll('img'))) {
    const src = image.getAttribute('src');
    if (src) {
      const inlined = await loader.resolveAsset(src, sourceDir);
      if (inlined) image.setAttribute('src', inlined);
      else if (!/^(?:data:|blob:)/i.test(src)) image.removeAttribute('src');
    }
    const srcset = image.getAttribute('srcset');
    if (srcset) {
      const entries = await Promise.all(
        srcset.split(',').map(async entry => {
          const [url, ...descriptor] = entry.trim().split(/\s+/);
          const inlined = await loader.resolveAsset(url, sourceDir);
          return inlined ? `${inlined}${descriptor.length ? ` ${descriptor.join(' ')}` : ''}` : '';
        })
      );
      if (entries.some(Boolean)) image.setAttribute('srcset', entries.filter(Boolean).join(', '));
      else image.removeAttribute('srcset');
    }
  }

  // 样式来源内联与打标（P3.5 §1）：与静态预览共用同一函数（link→style + url() 改写）。
  await inlineStyleSources(doc, sourceDir, loader);

  // 导航标记与 blocked.links 统计（构建期分类，须在远程剥离前计数）：
  // 相对 .html/.htm（可带 #hash/?query）→ data-zclaudia-nav；# 锚点不动；
  // 外部 scheme 与相对非 HTML 链接交由桥接运行期阻止并计入 blocked.links。
  doc.querySelectorAll('a[href]').forEach(anchor => {
    const href = anchor.getAttribute('href') ?? '';
    const value = href.trim();
    if (!value || value.startsWith('#')) return;
    if (REMOTE_REFERENCE.test(value)) {
      blocked.links += 1;
      return;
    }
    const path = resolveWorkspaceRef(value, sourceDir);
    if (/\.html?$/i.test(path)) anchor.setAttribute('data-zclaudia-nav', path);
    else blocked.links += 1;
  });

  // 表单与远程引用剥离：同静态预览（远程 a[href] 已在上面计数）。
  doc.querySelectorAll('form[action]').forEach(form => form.removeAttribute('action'));
  doc.querySelectorAll('[src^="http"], [href^="http"], [action]').forEach(el => {
    if (el.matches('a[href]')) el.removeAttribute('href');
    else if (el.hasAttribute('src')) el.removeAttribute('src');
    else el.removeAttribute('action');
  });

  const csp = doc.createElement('meta');
  csp.httpEquiv = 'Content-Security-Policy';
  csp.content = RUN_CSP;
  doc.head.prepend(csp);

  const bridge = doc.createElement('script');
  bridge.textContent = makeRunBridge(channel);
  doc.head.insertBefore(bridge, doc.head.children[1] ?? null);
  return { html: `<!doctype html>\n${doc.documentElement.outerHTML}`, blocked };
}

function normalizeRunPath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(decodeURIComponent(part));
  }
  return parts.join('/');
}

/** 原始引用值（剥离 ?query/#hash）→ 工作区相对路径。 */
function resolveWorkspaceRef(raw: string, fromDir: string): string {
  const path = raw.split(/[?#]/, 1)[0];
  return normalizeRunPath(path.startsWith('/') ? path : `${fromDir}${path}`);
}

/** 运行桥接：存储 shim + submit/click 拦截 + design-navigate / design-nav-blocked 上报（无选区消息）。 */
function makeRunBridge(channel: string): string {
  const safeChannel = JSON.stringify(channel).replace(/</g, '\\u003c');
  return `(() => {
    const channel=${safeChannel};
    // opaque origin 下真实存储抛错：探测失败则以 defineProperty 注入内存 shim（可用、不持久、刷新即失）。
    const makeStorageShim = () => {
      const entries = new Map();
      return {
        getItem: key => (entries.has(String(key)) ? entries.get(String(key)) : null),
        setItem: (key, value) => {
          const k = String(key);
          const v = String(value);
          if (v.length > 65536 || (!entries.has(k) && entries.size >= 100))
            throw new Error('QuotaExceededError');
          entries.set(k, v);
        },
        removeItem: key => {
          entries.delete(String(key));
        },
        key: index => {
          let i = 0;
          for (const k of entries.keys()) {
            if (i === index) return k;
            i += 1;
          }
          return null;
        },
        get length() {
          return entries.size;
        },
        clear: () => entries.clear()
      };
    };
    try {
      window.localStorage.getItem;
    } catch {
      Object.defineProperty(window, 'localStorage', { value: makeStorageShim() });
    }
    try {
      window.sessionStorage.getItem;
    } catch {
      Object.defineProperty(window, 'sessionStorage', { value: makeStorageShim() });
    }
    document.addEventListener('submit', event => event.preventDefault(), true);
    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const anchor = target.closest('a');
      if (!anchor) return;
      const navPath = anchor.getAttribute('data-zclaudia-nav');
      if (navPath) {
        event.preventDefault();
        parent.postMessage({ type:'zclaudia:design-navigate', channel, path: navPath }, '*');
        return;
      }
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#')) return;
      if (/^(?:[a-z][a-z\\d+.-]*:|\\/\\/)/i.test(href)) {
        event.preventDefault();
        parent.postMessage({ type:'zclaudia:design-nav-blocked', channel, reason:'external', href: href.slice(0, 500) }, '*');
        return;
      }
      if (href.trim()) {
        event.preventDefault();
        parent.postMessage({ type:'zclaudia:design-nav-blocked', channel, reason:'unsupported', href: href.slice(0, 500) }, '*');
      }
      // 其余（# 锚点、无 href）放行；普通元素点击不拦截，作品交互自理。
    }, true);
  })();`;
}
