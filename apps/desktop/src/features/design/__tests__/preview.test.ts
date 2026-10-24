// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { buildDesignPreview } from '../preview';

const STYLE_KEYS = [
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'text-align',
  'width',
  'height',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-width',
  'border-style',
  'border-color',
  'border-radius',
  'object-fit',
];

interface BridgeHarness {
  window: JSDOM['window'];
  document: Document;
  sent: Record<string, unknown>[];
  post: (data: unknown) => void;
  close: () => void;
}

async function openBridge(
  source: string,
  channel: string,
  loadAsset: (path: string) => Promise<{ mimeType: string; data: string }> = async () => {
    throw new Error('no assets');
  }
): Promise<BridgeHarness> {
  const html = await buildDesignPreview(source, 'index.html', loadAsset, channel, 'bridge-rev');
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  const sent: Record<string, unknown>[] = [];
  Object.defineProperty(dom.window, 'parent', {
    configurable: true,
    value: { postMessage: (message: unknown) => sent.push(message as Record<string, unknown>) },
  });
  dom.window.eval(dom.window.document.querySelector('script')?.textContent ?? '');
  return {
    window: dom.window,
    document: dom.window.document,
    sent,
    post: (data: unknown) =>
      dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data })),
    close: () => dom.window.close(),
  };
}

describe('buildDesignPreview', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(23),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('inlines local assets and enforces an opaque, network-blocked preview with a channel bridge', async () => {
    const loadAsset = vi.fn(async (path: string) => {
      if (path === 'site/images/a.png') return { mimeType: 'image/png', data: 'YWJj' };
      if (path === 'css/site.css')
        return { mimeType: 'text/css', data: 'Ym9keXtiYWNrZ3JvdW5kOnVybChpbWFnZXMvYS5wbmcpfQ==' };
      if (path === 'site/css/images/a.png') return { mimeType: 'image/png', data: 'YWJj' };
      throw new Error('missing');
    });
    const html = await buildDesignPreview(
      '<html><head><base href="https://evil.invalid/"><meta HTTP-EQUIV="ReFrEsH" content="0;url=https://evil.invalid"><meta http-equiv="Content-Security-Policy" content="script-src *"><link rel="stylesheet" href="/css/site.css"></head><body><img src="images/a.png" onerror="fetch(\'https://evil.invalid\')"><img src="https://evil.invalid/a.png"><script>fetch("https://evil.invalid")</script><object data="evil"><p>Bad object</p></object><iframe src="https://evil.invalid"></iframe><p>Static</p></body></html>',
      'site/index.html',
      loadAsset,
      'frame-7',
      'draft-rev-7'
    );
    expect(html).toContain('data:image/png;base64,YWJj');
    expect(html).not.toContain('https://evil.invalid/a.png');
    expect(html).not.toContain('<base');
    expect(html).not.toContain('http-equiv="refresh"');
    expect(html).not.toContain('script-src *');
    expect(html).not.toContain('onerror=');
    expect(html).not.toContain('fetch(');
    expect(html).not.toContain('<object');
    expect(html).not.toContain('<iframe');
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("default-src 'none'");
    expect(html).toContain('channel="frame-7"');
    expect(html).toContain("type:'zclaudia:design-select'");
    expect(html).toContain("'zclaudia:design-verify'");
    expect(html).toContain("type:'zclaudia:design-verify-result'");
    expect(html).toContain('data-zclaudia-path="[5]"');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const scripts = Array.from(doc.querySelectorAll('script'));
    expect(scripts).toHaveLength(1);
    const nonce = scripts[0].getAttribute('nonce');
    expect(nonce).toBeTruthy();
    expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content).toContain(
      `script-src 'nonce-${nonce}'`
    );
    expect(loadAsset).toHaveBeenCalledWith('site/images/a.png');
    expect(loadAsset).toHaveBeenCalledWith('css/site.css');
  });

  it('caches paths and stops loading assets after the size limit', async () => {
    const loadAsset = vi.fn(async () => ({ mimeType: 'image/png', data: 'A'.repeat(5_600_000) }));
    const html = await buildDesignPreview(
      '<body><img src="a.png"><img src="a.png"><img src="b.png"></body>',
      'index.html',
      loadAsset,
      'c',
      'rev'
    );
    expect(loadAsset).toHaveBeenCalledTimes(2);
    expect(html).not.toContain('data:image/png');
  });

  it('can select a marked element before DOMContentLoaded initializes the identity map', async () => {
    const html = await buildDesignPreview(
      '<body><main><p>Before ready</p></main></body>',
      'index.html',
      async () => {
        throw new Error('no assets');
      },
      'early',
      'early-rev'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    const { document } = dom.window;
    const sent: unknown[] = [];
    Object.defineProperty(dom.window, 'parent', {
      configurable: true,
      value: { postMessage: (message: unknown) => sent.push(message) },
    });
    const addEventListener = document.addEventListener.bind(document);
    document.addEventListener = ((
      type: string,
      ...args: Parameters<Document['addEventListener']>
    ) => {
      if (type !== 'DOMContentLoaded') addEventListener(type, ...args);
    }) as Document['addEventListener'];

    dom.window.eval(document.querySelector('script')?.textContent ?? '');
    document
      .querySelector('p')
      ?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: 'zclaudia:design-select',
      channel: 'early',
      selection: {
        elementPath: [0, 0],
        tagName: 'p',
        text: 'Before ready',
        sourceText: 'Before ready',
        base: 'early-rev',
      },
    });
    dom.window.close();
  });

  it('answers a design-verify request with the computed colors of the element at the path', async () => {
    const html = await buildDesignPreview(
      '<body><main><p id="target">Styled</p><p>Other</p></main></body>',
      'index.html',
      async () => {
        throw new Error('no assets');
      },
      'verify-channel',
      'verify-rev'
    );
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    const { document } = dom.window;
    const sent: unknown[] = [];
    Object.defineProperty(dom.window, 'parent', {
      configurable: true,
      value: { postMessage: (message: unknown) => sent.push(message) },
    });
    dom.window.eval(document.querySelector('script')?.textContent ?? '');

    const post = (data: unknown) =>
      dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data }));

    post({ type: 'zclaudia:design-verify', channel: 'verify-channel', elementPath: [0, 0] });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: 'zclaudia:design-verify-result',
      channel: 'verify-channel',
      elementPath: [0, 0],
    });
    expect(typeof (sent[0] as { color?: unknown }).color).toBe('string');
    expect(typeof (sent[0] as { backgroundColor?: unknown }).backgroundColor).toBe('string');

    // An empty path resolves to the body itself.
    post({ type: 'zclaudia:design-verify', channel: 'verify-channel', elementPath: [] });
    expect(sent).toHaveLength(2);

    // Wrong channel, unresolvable paths and malformed payloads stay silent.
    post({ type: 'zclaudia:design-verify', channel: 'other', elementPath: [0] });
    post({ type: 'zclaudia:design-verify', channel: 'verify-channel', elementPath: [9, 9] });
    post({ type: 'zclaudia:design-verify', channel: 'verify-channel', elementPath: 'nope' });
    post({ type: 'zclaudia:design-verify', channel: 'verify-channel', elementPath: [-1] });
    post({ type: 'zclaudia:design-verify', channel: 'verify-channel' });
    expect(sent).toHaveLength(2);

    dom.window.close();
  });

  it('click selections carry computed styles, whitelist attrs and the inline style attribute', async () => {
    const harness = await openBridge(
      '<body><p style="color: red" class="note">Styled</p><span>Plain</span></body>',
      'styled-channel'
    );
    harness.document
      .querySelector('p')
      ?.dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));

    expect(harness.sent).toHaveLength(1);
    const selection = harness.sent[0]?.selection as Record<string, unknown>;
    expect(harness.sent[0]).toMatchObject({
      type: 'zclaudia:design-select',
      channel: 'styled-channel',
      selection: {
        elementPath: [0],
        tagName: 'p',
        base: 'bridge-rev',
      },
    });
    // jsdom computes most layout keywords; unsupported keys (e.g. text-align here) stay absent.
    const styles = selection.styles as Record<string, unknown>;
    expect(Object.keys(styles).length).toBeGreaterThan(0);
    for (const key of Object.keys(styles)) {
      expect(STYLE_KEYS).toContain(key);
      expect(typeof styles[key]).toBe('string');
      expect((styles[key] as string).length).toBeLessThanOrEqual(120);
    }
    expect(styles['font-size']).toBe('medium');
    expect(styles['object-fit']).toBe('fill');
    expect(styles['text-align']).toBeUndefined();
    expect(selection.inlineStyle).toBe('color: red');
    expect(selection.attrs).toBeUndefined();
    harness.close();
  });

  it('click selections of img/a elements carry only attributes the element actually has', async () => {
    const harness = await openBridge(
      '<body><a href="#section"><img src="a.png" alt="A picture"></a><a>No href</a></body>',
      'attrs-channel',
      async path => {
        if (path === 'a.png') return { mimeType: 'image/png', data: 'YWJj' };
        throw new Error('missing');
      }
    );
    harness.document
      .querySelector('img')
      ?.dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
    expect(harness.sent).toHaveLength(1);
    const imgSelection = harness.sent[0]?.selection as Record<string, unknown>;
    expect(imgSelection.tagName).toBe('img');
    expect(imgSelection.attrs).toEqual({
      src: 'data:image/png;base64,YWJj',
      alt: 'A picture',
    });

    harness.document
      .querySelectorAll('a')[1]
      ?.dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
    expect(harness.sent).toHaveLength(2);
    const aSelection = harness.sent[1]?.selection as Record<string, unknown>;
    expect(aSelection.tagName).toBe('a');
    expect(aSelection.attrs).toBeUndefined();

    harness.document
      .querySelector('a')
      ?.dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
    expect(harness.sent).toHaveLength(3);
    const linkSelection = harness.sent[2]?.selection as Record<string, unknown>;
    expect(linkSelection.attrs).toEqual({ href: '#section' });
    harness.close();
  });

  it('selects unmarked elements by path and answers failures for out-of-tree paths', async () => {
    const harness = await openBridge(
      '<body><main><p>Target</p><div style="width: 10px"></div></main></body>',
      'path-channel'
    );

    harness.post({ type: 'zclaudia:design-select-path', channel: 'path-channel', elementPath: [0, 0] });
    expect(harness.sent).toHaveLength(1);
    const selection = harness.sent[0]?.selection as Record<string, unknown>;
    expect(harness.sent[0]).toMatchObject({
      type: 'zclaudia:design-select',
      channel: 'path-channel',
      selection: { elementPath: [0, 0], tagName: 'p', base: 'bridge-rev' },
    });
    // select-path has no saved-source text, so sourceText is omitted; styles still ride along.
    expect('sourceText' in selection).toBe(false);
    expect(Object.keys(selection.styles as Record<string, unknown>).length).toBeGreaterThan(0);
    expect(harness.document.querySelector('p')?.style.outline).toBe('2px dashed #808080');
    expect(harness.document.querySelector('p')?.style.outlineOffset).toBe('3px');

    // A second selection restores the previously highlighted element's outline.
    harness.post({ type: 'zclaudia:design-select-path', channel: 'path-channel', elementPath: [0] });
    expect(harness.sent).toHaveLength(2);
    expect((harness.sent[1]?.selection as Record<string, unknown>).tagName).toBe('main');
    expect(harness.document.querySelector('p')?.style.outline).toBe('');
    expect(harness.document.querySelector('main')?.style.outline).toBe('2px dashed #808080');

    // Out-of-tree paths report failure; malformed payloads and wrong channels stay silent.
    harness.post({ type: 'zclaudia:design-select-path', channel: 'path-channel', elementPath: [9, 9] });
    expect(harness.sent).toHaveLength(3);
    expect(harness.sent[2]).toEqual({
      type: 'zclaudia:design-select-failed',
      channel: 'path-channel',
      reason: 'not-found',
    });

    harness.post({ type: 'zclaudia:design-select-path', channel: 'other', elementPath: [0] });
    harness.post({ type: 'zclaudia:design-select-path', channel: 'path-channel', elementPath: 'nope' });
    harness.post({ type: 'zclaudia:design-select-path', channel: 'path-channel', elementPath: [-1] });
    harness.post({ type: 'zclaudia:design-select-path', channel: 'path-channel', elementPath: [0.5] });
    expect(harness.sent).toHaveLength(3);
    harness.close();
  });
});

// ---- P3.5 §1 样式来源标记（C1） ----

describe('P3.5 style origin marking', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(23),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('marks link-derived styles with the workspace-relative css path and own style blocks with @inline ordinals', async () => {
    const loadAsset = vi.fn(async (path: string) => {
      if (path === 'css/site.css')
        return { mimeType: 'text/css', data: btoa('a { color: green; background: url(bg.png) }') };
      if (path === 'theme.css') return { mimeType: 'text/css', data: btoa('b {}') };
      // css 内 url() 相对 CSS 文件目录解析（css/bg.png），行内样式相对入口页（bg.png）。
      if (path === 'css/bg.png' || path === 'bg.png')
        return { mimeType: 'image/png', data: 'YWJj' };
      throw new Error('missing');
    });
    const html = await buildDesignPreview(
      '<html><head><link rel="stylesheet" href="css/site.css"><style>p { color: red }</style>' +
        '<link rel="stylesheet" href="theme.css"><style>a { color: blue }</style></head>' +
        '<body><p style="background: url(bg.png)">x</p></body></html>',
      'index.html',
      loadAsset,
      'origin-ch',
      'origin-rev'
    );
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const styles = Array.from(doc.querySelectorAll('style'));
    expect(styles).toHaveLength(4);
    // link 内联块打工作区相对路径；入口自有块按文档序 @inline/0、@inline/1（link 替换不占用序号）。
    expect(styles.map(style => style.getAttribute('data-zclaudia-style-origin'))).toEqual([
      'css/site.css',
      '@inline/0',
      'theme.css',
      '@inline/1',
    ]);
    expect(doc.querySelectorAll('link[rel~="stylesheet"]')).toHaveLength(0);
    // url() 改写行为不变：link 块内相对背景图与行内样式都换成 data URL。
    expect(styles[0].textContent).toContain('url("data:image/png;base64,YWJj")');
    expect(doc.querySelector('p')?.getAttribute('style')).toContain(
      'url("data:image/png;base64,YWJj")'
    );
  });
});

// ---- P3.5 §2 桥接生效规则枚举（C1） ----

describe('design-rules bridge', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(23),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('answers rules-request with matched rules in document order, origins, selector-group hits and specificity', async () => {
    const harness = await openBridge(
      '<head><link rel="stylesheet" href="theme.css">' +
        '<style>#wrap p, .card { color: red } li:not(.skip) + li { color: green }' +
        '@media (min-width: 1px) { h1 { font-size: 32px !important; color: blue !important } }</style></head>' +
        '<body><div id="wrap"><p class="note card" data-k="v">Hit</p></div>' +
        '<ul><li>first</li><li class="skip">second</li><li>third</li></ul><h1>H</h1></body>',
      'rules-ch',
      async path => {
        if (path === 'theme.css')
          return {
            mimeType: 'text/css',
            data: btoa('p { margin: 0 } p[data-k="v"]:first-child { color: pink } [hidden] { display: none }'),
          };
        throw new Error('missing');
      }
    );

    // p.note：theme.css 两条 + 自有块选择器组两个命中选择器（#wrap p 与 .card 都命中 → 各上报一条）。
    harness.post({ type: 'zclaudia:design-rules-request', channel: 'rules-ch', elementPath: [0, 0] });
    expect(harness.sent).toHaveLength(1);
    expect(harness.sent[0]).toMatchObject({
      type: 'zclaudia:design-rules',
      channel: 'rules-ch',
      elementPath: [0, 0],
    });
    expect((harness.sent[0] as { truncated?: boolean }).truncated).toBeUndefined();
    expect((harness.sent[0] as { rules: unknown[] }).rules).toEqual([
      {
        origin: 'theme.css',
        rulePath: [0],
        selectorText: 'p',
        specificity: [0, 0, 1],
        importantProps: [],
      },
      {
        origin: 'theme.css',
        rulePath: [1],
        selectorText: 'p[data-k="v"]:first-child',
        specificity: [0, 2, 1],
        importantProps: [],
      },
      {
        origin: '@inline/0',
        rulePath: [0],
        selectorText: '#wrap p',
        specificity: [1, 0, 1],
        importantProps: [],
      },
      {
        origin: '@inline/0',
        rulePath: [0],
        selectorText: '.card',
        specificity: [0, 1, 0],
        importantProps: [],
      },
    ]);

    // li.skip：:not() 参数递归计入特异性（li + .skip + li → [0,1,2]）；组外选择器不命中不上报。
    harness.post({ type: 'zclaudia:design-rules-request', channel: 'rules-ch', elementPath: [1, 1] });
    expect((harness.sent[1] as { rules: unknown[] }).rules).toEqual([
      {
        origin: '@inline/0',
        rulePath: [1],
        selectorText: 'li:not(.skip) + li',
        specificity: [0, 1, 2],
        importantProps: [],
      },
    ]);

    // h1：@media 分组规则嵌套索引 rulePath [2,0]，!important 属性名随规则上报。
    harness.post({ type: 'zclaudia:design-rules-request', channel: 'rules-ch', elementPath: [2] });
    expect((harness.sent[2] as { rules: unknown[] }).rules).toEqual([
      {
        origin: '@inline/0',
        rulePath: [2, 0],
        selectorText: 'h1',
        specificity: [0, 0, 1],
        importantProps: ['font-size', 'color'],
      },
    ]);
    harness.close();
  });

  it('caps matched rules at 200 with the truncated flag and truncates long selector text', async () => {
    const classes = Array.from({ length: 210 }, (_, index) => `c${index}`).join(' ');
    const longSelector = '.c0'.repeat(110); // 330 字符 > 300 上限
    const css =
      `${longSelector} { color: red }` +
      Array.from({ length: 209 }, (_, index) => `.c${index + 1} { color: red }`).join('');
    const harness = await openBridge(
      `<head><style>${css}</style></head><body><div class="${classes}">x</div></body>`,
      'cap-ch'
    );

    harness.post({ type: 'zclaudia:design-rules-request', channel: 'cap-ch', elementPath: [0] });
    expect(harness.sent).toHaveLength(1);
    const message = harness.sent[0] as {
      rules: Array<{ selectorText: string; specificity: number[] }>;
      truncated?: boolean;
    };
    expect(message.truncated).toBe(true);
    expect(message.rules).toHaveLength(200);
    // 首条：超长选择器截断到 300，特异性仍按完整命中选择器计算（110 个 class）。
    expect(message.rules[0]!.selectorText).toHaveLength(300);
    expect(message.rules[0]!.selectorText.startsWith('.c0.c0')).toBe(true);
    expect(message.rules[0]!.specificity).toEqual([0, 110, 0]);
    expect(message.rules[1]!.selectorText).toBe('.c1');
    harness.close();
  });

  it('stays silent for foreign or malformed requests and skips sheets without an origin marker', async () => {
    const harness = await openBridge(
      '<body><style>p { margin: 0 }</style><p>x</p></body>',
      'quiet-ch'
    );

    // 错误 channel、畸形路径、解析不到元素：全部静默（不回发 select-failed 同款失败消息）。
    harness.post({ type: 'zclaudia:design-rules-request', channel: 'other', elementPath: [0] });
    harness.post({ type: 'zclaudia:design-rules-request', channel: 'quiet-ch', elementPath: 'nope' });
    harness.post({ type: 'zclaudia:design-rules-request', channel: 'quiet-ch', elementPath: [-1] });
    harness.post({ type: 'zclaudia:design-rules-request', channel: 'quiet-ch', elementPath: [9] });
    expect(harness.sent).toHaveLength(0);

    // 防御：ownerNode 缺来源标记的 sheet 跳过（harness 摘除标记模拟）→ 命中规则为空但仍回发空消息。
    harness.document
      .querySelector('style')
      ?.removeAttribute('data-zclaudia-style-origin');
    harness.post({ type: 'zclaudia:design-rules-request', channel: 'quiet-ch', elementPath: [0] });
    expect(harness.sent).toHaveLength(1);
    expect(harness.sent[0]).toEqual({
      type: 'zclaudia:design-rules',
      channel: 'quiet-ch',
      elementPath: [0],
      rules: [],
    });
    harness.close();
  });
});
