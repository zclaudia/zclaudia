// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { buildDesignRunPreview } from '../interactive';

/** 运行模式 CSP（设计 §1 原文）。 */
const RUN_CSP =
  "default-src 'none'; img-src data: blob:; media-src data: blob:; font-src data:; style-src 'unsafe-inline' data:; script-src 'unsafe-inline' data: blob:; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";

const noAssets = async (): Promise<{ mimeType: string; data: string }> => {
  throw new Error('no assets');
};

interface RunHarness {
  window: JSDOM['window'];
  document: Document;
  sent: Record<string, unknown>[];
  evalBridge: () => void;
  close: () => void;
}

async function openRunBridge(
  source: string,
  channel: string,
  loadAsset: (path: string) => Promise<{ mimeType: string; data: string }> = noAssets,
  filePath = 'index.html'
): Promise<RunHarness> {
  const { html } = await buildDesignRunPreview({ source, filePath, loadAsset, channel });
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  const sent: Record<string, unknown>[] = [];
  Object.defineProperty(dom.window, 'parent', {
    configurable: true,
    value: { postMessage: (message: unknown) => sent.push(message as Record<string, unknown>) },
  });
  return {
    window: dom.window,
    document: dom.window.document,
    sent,
    // 真实执行生成 html 里的运行桥接脚本
    evalBridge: () => {
      const bridge = Array.from(dom.window.document.querySelectorAll('script')).find(script =>
        (script.textContent ?? '').includes('design-navigate')
      );
      const text = bridge?.textContent;
      if (!text) throw new Error('run bridge script missing');
      dom.window.eval(text);
    },
    close: () => dom.window.close(),
  };
}

function clickLink(harness: RunHarness, selector: string): MouseEvent {
  const target = harness.document.querySelector(selector);
  if (!target) throw new Error(`missing element: ${selector}`);
  const event = new harness.window.MouseEvent('click', { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

function parseRunHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('buildDesignRunPreview', () => {
  it('removes remote script srcs into the blocked count and keeps inline scripts plus on* handlers', async () => {
    const loadAsset = vi.fn(noAssets);
    const { html, blocked } = await buildDesignRunPreview({
      source:
        '<body><script src="https://evil.invalid/a.js"></script><script src="//cdn.invalid/b.js"></script><script>window.__inline=1</script><button onclick="window.__clicked=1">Go</button></body>',
      filePath: 'index.html',
      loadAsset,
      channel: 'run',
    });
    expect(blocked.scripts).toBe(2);
    expect(blocked.links).toBe(0);
    expect(html).not.toContain('evil.invalid/a.js');
    expect(html).not.toContain('cdn.invalid/b.js');
    // 无 src 的内联脚本与 on* 内联事件原样保留
    expect(html).toContain('<script>window.__inline=1</script>');
    expect(html).toContain('onclick="window.__clicked=1"');
    // 远程脚本绝不触发资产加载
    expect(loadAsset).not.toHaveBeenCalled();
  });

  it('inlines local script srcs as executable text read through loadAsset', async () => {
    const loadAsset = vi.fn(async (path: string) => {
      if (path === 'app.js')
        return { mimeType: 'text/javascript', data: 'd2luZG93Ll9fYXBwPTEyMw==' };
      throw new Error('missing');
    });
    const harness = await openRunBridge(
      '<body><script src="app.js"></script></body>',
      'exec-ch',
      loadAsset
    );
    expect(loadAsset).toHaveBeenCalledWith('app.js');
    expect(harness.document.querySelector('script[src]')).toBeNull();
    expect(harness.document.body.querySelector('script')?.textContent).toBe('window.__app=123');
    expect(harness.window.document.body.innerHTML).toContain('window.__app=123');
    harness.evalBridge();
    // 内联进来的页面脚本真实可执行（harness window 里的副作用）
    harness.window.eval(harness.document.body.querySelector('script')?.textContent ?? '');
    expect(harness.window.eval('window.__app')).toBe(123);
    harness.close();
  });

  it('marks relative html links with data-zclaudia-nav and counts other links as blocked', async () => {
    const { html, blocked } = await buildDesignRunPreview({
      source:
        '<body><a href="about.html">A</a><a href="sub/page.htm?x=1#frag">S</a><a href="../top.html">U</a><a href="doc.pdf">P</a><a href="//cdn.invalid/x">E</a><a href="#section">H</a></body>',
      filePath: 'site/pages/index.html',
      loadAsset: noAssets,
      channel: 'nav-ch',
    });
    const doc = parseRunHtml(html);
    const nav = (href: string) =>
      doc.querySelector(`a[href="${href}"]`)?.getAttribute('data-zclaudia-nav');
    // 子目录 / 上级目录解析、.htm 后缀、#hash/?query 剥离
    expect(nav('about.html')).toBe('site/pages/about.html');
    expect(nav('sub/page.htm?x=1#frag')).toBe('site/pages/sub/page.htm');
    expect(nav('../top.html')).toBe('site/top.html');
    // 原 href 保留（供 :link 样式）；锚点与不可导航链接不标记
    expect(doc.querySelector('a[href="about.html"]')?.getAttribute('href')).toBe('about.html');
    expect(doc.querySelector('a[href="#section"]')?.hasAttribute('data-zclaudia-nav')).toBe(false);
    expect(doc.querySelector('a[href="doc.pdf"]')?.hasAttribute('data-zclaudia-nav')).toBe(false);
    expect(
      doc.querySelector('a[href="//cdn.invalid/x"]')?.hasAttribute('data-zclaudia-nav')
    ).toBe(false);
    expect(blocked.links).toBe(2);
    expect(blocked.scripts).toBe(0);
  });

  it('bridge click: nav links report design-navigate; external and unsupported links are blocked; anchors pass', async () => {
    const harness = await openRunBridge(
      '<body><a href="next.html" id="nav"><span>Next</span></a><a href="//evil.invalid/x" id="ext">Ext</a><a href="doc.pdf" id="pdf">PDF</a><a href="#top" id="hash">Hash</a><span id="plain">Plain</span></body>',
      'click-ch'
    );
    harness.evalBridge();

    // data-zclaudia-nav 链接（含后代点击）：preventDefault + design-navigate
    const navEvent = clickLink(harness, '#nav span');
    expect(navEvent.defaultPrevented).toBe(true);
    expect(harness.sent).toEqual([
      { type: 'zclaudia:design-navigate', channel: 'click-ch', path: 'next.html' },
    ]);

    // 外部 scheme（// 协议相对；http(s) 已在构建期剥离 href）→ reason external
    const extEvent = clickLink(harness, '#ext');
    expect(extEvent.defaultPrevented).toBe(true);
    expect(harness.sent[1]).toEqual({
      type: 'zclaudia:design-nav-blocked',
      channel: 'click-ch',
      reason: 'external',
      href: '//evil.invalid/x',
    });

    // 相对非 HTML → reason unsupported
    const pdfEvent = clickLink(harness, '#pdf');
    expect(pdfEvent.defaultPrevented).toBe(true);
    expect(harness.sent[2]).toEqual({
      type: 'zclaudia:design-nav-blocked',
      channel: 'click-ch',
      reason: 'unsupported',
      href: 'doc.pdf',
    });

    // # 锚点与普通元素放行，不 postMessage
    const hashEvent = clickLink(harness, '#hash');
    const plainEvent = clickLink(harness, '#plain');
    expect(hashEvent.defaultPrevented).toBe(false);
    expect(plainEvent.defaultPrevented).toBe(false);
    expect(harness.sent).toHaveLength(3);
    harness.close();
  });

  it('installs working in-memory storage shims when real storage access throws (opaque origin)', async () => {
    const harness = await openRunBridge('<body><p>x</p></body>', 'store-ch');
    // 删掉真实存储模拟 opaque origin：桥接探测抛错后走 defineProperty 注入分支
    delete (harness.window as unknown as { localStorage?: unknown }).localStorage;
    delete (harness.window as unknown as { sessionStorage?: unknown }).sessionStorage;
    harness.evalBridge();

    const storage = harness.window.localStorage;
    // 内存 shim 而非真实 Storage 实现（不持久，刷新即失；每文档独立实例）
    expect(storage).not.toBeInstanceOf(harness.window.Storage);
    expect(harness.window.sessionStorage).not.toBe(storage);
    expect(harness.window.sessionStorage.getItem('a')).toBeNull();

    expect(storage.length).toBe(0);
    storage.setItem('k', 'v');
    expect(storage.getItem('k')).toBe('v');
    expect(storage.getItem('missing')).toBeNull();
    expect(storage.key(0)).toBe('k');
    expect(storage.length).toBe(1);
    storage.removeItem('k');
    expect(storage.length).toBe(0);
    storage.setItem('a', '1');
    storage.clear();
    expect(storage.length).toBe(0);
    // 防滥用：单值 > 64KiB 拒绝写入
    expect(() => storage.setItem('big', 'x'.repeat(65_537))).toThrow();
    harness.close();
  });

  it('injects the exact run-mode CSP meta without any nonce, with the channel escaped like the static bridge', async () => {
    const { html } = await buildDesignRunPreview({
      source: '<body><p>x</p></body>',
      filePath: 'index.html',
      loadAsset: noAssets,
      channel: 'ch<1',
    });
    const doc = parseRunHtml(html);
    expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content).toBe(RUN_CSP);
    expect(doc.querySelectorAll('script[nonce]')).toHaveLength(0);
    // channel 转义规则与静态 makeBridge 一致：< → \u003c
    expect(html).not.toContain('ch<1');
    expect(html).toContain('ch\\u003c1');
  });

  it('prevents form submission in the capture phase', async () => {
    const harness = await openRunBridge('<body><form><input name="a"></form></body>', 'form-ch');
    harness.evalBridge();
    const event = new harness.window.Event('submit', { bubbles: true, cancelable: true });
    harness.document.querySelector('form')?.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    harness.close();
  });

  it('removes local scripts beyond the count, per-script and total size limits into the blocked count', async () => {
    // 数量上限：13 个本地脚本仅内联前 12 个
    const many = Array.from({ length: 13 }, (_, i) => `<script src="s${i}.js"></script>`).join('');
    const counted = await buildDesignRunPreview({
      source: `<body>${many}</body>`,
      filePath: 'index.html',
      loadAsset: async () => ({ mimeType: 'text/javascript', data: 'QUJD' }),
      channel: 'limit-ch',
    });
    expect(counted.blocked.scripts).toBe(1);
    expect(parseRunHtml(counted.html).querySelectorAll('script')).toHaveLength(13); // 12 内联 + 1 桥接
    expect(counted.html).not.toContain('s12.js');

    // 单脚本超限：解码约 525000 字节 > 512 KiB
    const oversized = await buildDesignRunPreview({
      source: '<body><script src="big.js"></script></body>',
      filePath: 'index.html',
      loadAsset: async () => ({ mimeType: 'text/javascript', data: 'A'.repeat(700_000) }),
      channel: 'limit-ch',
    });
    expect(oversized.blocked.scripts).toBe(1);
    expect(oversized.html).not.toContain('big.js');

    // 总量超限：4 × 450000 = 1.8MiB 后，第 5 个突破 2MiB 总预算
    const chunked = Array.from({ length: 5 }, (_, i) => `<script src="c${i}.js"></script>`).join(
      ''
    );
    const totals = await buildDesignRunPreview({
      source: `<body>${chunked}</body>`,
      filePath: 'index.html',
      loadAsset: async () => ({ mimeType: 'text/javascript', data: 'A'.repeat(600_000) }),
      channel: 'limit-ch',
    });
    expect(totals.blocked.scripts).toBe(1);
    expect(totals.html).not.toContain('c4.js');
    // 内联成功的脚本已移除 src（共 4 个内联 + 1 个桥接；解码 450000 字节）
    const scripts = parseRunHtml(totals.html).querySelectorAll('script');
    expect(scripts).toHaveLength(5);
    expect(
      Array.from(scripts).filter(script => script.textContent?.length === 450_000)
    ).toHaveLength(4);
  });

  it('strips form actions and remote hrefs/srcs the same way as the static preview', async () => {
    const { html, blocked } = await buildDesignRunPreview({
      source:
        '<body><form action="https://evil.invalid/submit"><input></form><a href="https://evil.invalid/l">L</a><img src="https://evil.invalid/i.png"><div action="https://evil.invalid/d">d</div></body>',
      filePath: 'index.html',
      loadAsset: noAssets,
      channel: 'strip-ch',
    });
    const doc = parseRunHtml(html);
    expect(doc.querySelector('form')?.hasAttribute('action')).toBe(false);
    expect(doc.querySelector('a')?.hasAttribute('href')).toBe(false);
    expect(doc.querySelector('img')?.hasAttribute('src')).toBe(false);
    expect(doc.querySelector('div')?.hasAttribute('action')).toBe(false);
    expect(html).not.toContain('evil.invalid');
    // 远程 a[href] 计入 blocked.links（图片与表单 action 不计）
    expect(blocked.links).toBe(1);
  });

  it('inlines images, srcset and stylesheets through the same shared asset loader', async () => {
    const loadAsset = vi.fn(async (path: string) => {
      if (path === 'images/a.png') return { mimeType: 'image/png', data: 'YWJj' };
      if (path === 'css/site.css')
        return {
          mimeType: 'text/css',
          data: 'Ym9keXtiYWNrZ3JvdW5kOnVybCguLi9pbWFnZXMvYS5wbmcpfQ==',
        };
      throw new Error('missing');
    });
    const { html } = await buildDesignRunPreview({
      source:
        '<head><link rel="stylesheet" href="css/site.css"></head><body><img src="images/a.png" srcset="images/a.png 2x"></body>',
      filePath: 'index.html',
      loadAsset,
      channel: 'asset-ch',
    });
    // link[stylesheet] 内联为 <style>（url() 经同一 loader 重写为 data URL）
    expect(html).not.toContain('<link');
    expect(parseRunHtml(html).querySelector('style')?.textContent).toContain(
      'url("data:image/png;base64,YWJj")'
    );
    // img src 与 srcset 内联
    expect(html).toContain('<img src="data:image/png;base64,YWJj"');
    expect(html).toContain('srcset="data:image/png;base64,YWJj 2x"');
    // 同一 loader 共享缓存：images/a.png（src、srcset、css url()）只加载一次，共 2 次调用
    expect(loadAsset).toHaveBeenCalledTimes(2);
    expect(loadAsset).toHaveBeenCalledWith('images/a.png');
    expect(loadAsset).toHaveBeenCalledWith('css/site.css');
  });
});
