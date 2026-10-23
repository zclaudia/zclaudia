/** Creates a sandbox-ready static HTML/CSS srcdoc. Local assets are inlined; scripts are not run. */
const MAX_ASSETS = 80;
const MAX_ASSET_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_ASSET_BYTES = 12 * 1024 * 1024;
const MAX_MARKED_ELEMENTS = 5000;
const MAX_VISITED_ELEMENTS = 10000;
const MAX_SELECTION_TEXT_LENGTH = 2000;

/** 计算样式白名单键，随 select 消息携带（DesignComputedStyles 键集）。 */
const BRIDGE_STYLE_KEYS = [
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
] as const;

/** select 消息额外携带的元素属性白名单。 */
const BRIDGE_ATTR_NAMES = ['src', 'alt', 'href'] as const;

export async function buildDesignPreview(
  source: string,
  filePath: string,
  loadAsset: (relativeWorkspacePath: string) => Promise<{ mimeType: string; data: string }>,
  channel: string,
  baseRevision: string
): Promise<string> {
  const doc = new DOMParser().parseFromString(source, 'text/html');
  markStaticElements(doc.body, []);
  doc.querySelectorAll('base, object, embed, iframe, script, meta[http-equiv]').forEach(node => {
    if (
      node.tagName.toLowerCase() !== 'meta' ||
      ['refresh', 'content-security-policy'].includes(
        (node.getAttribute('http-equiv') ?? '').toLowerCase()
      )
    ) {
      node.remove();
    }
  });
  doc.querySelectorAll('*').forEach(element => {
    Array.from(element.attributes).forEach(attribute => {
      if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
    });
  });

  const sourcePath = normalizeWorkspacePath(filePath);
  const sourceDir = sourcePath.slice(0, sourcePath.lastIndexOf('/') + 1);
  const assets = new Map<string, string | null>();
  let totalAssetBytes = 0;
  const loadInlineAsset = async (path: string): Promise<string | null> => {
    if (assets.has(path)) return assets.get(path)!;
    if (assets.size >= MAX_ASSETS) return null;
    try {
      const asset = await loadAsset(path);
      const bytes = Math.ceil((asset.data.length * 3) / 4);
      if (bytes > MAX_ASSET_BYTES || totalAssetBytes + bytes > MAX_TOTAL_ASSET_BYTES) {
        assets.set(path, null);
        return null;
      }
      totalAssetBytes += bytes;
      const result = `data:${asset.mimeType};base64,${asset.data}`;
      assets.set(path, result);
      return result;
    } catch {
      assets.set(path, null);
      return null;
    }
  };
  const resolveAsset = async (raw: string, fromDir = sourceDir): Promise<string | null> => {
    const value = raw.trim();
    if (!value || /^(?:data:|blob:|#|\/\/)/i.test(value) || /^[a-z][a-z\d+.-]*:/i.test(value))
      return null;
    return loadInlineAsset(workspacePath(value, fromDir));
  };

  for (const image of Array.from(doc.querySelectorAll('img'))) {
    const src = image.getAttribute('src');
    if (src) {
      const inlined = await resolveAsset(src);
      if (inlined) image.setAttribute('src', inlined);
      else if (!/^(?:data:|blob:)/i.test(src)) image.removeAttribute('src');
    }
    const srcset = image.getAttribute('srcset');
    if (srcset) {
      const entries = await Promise.all(
        srcset.split(',').map(async entry => {
          const [url, ...descriptor] = entry.trim().split(/\s+/);
          const inlined = await resolveAsset(url);
          return inlined ? `${inlined}${descriptor.length ? ` ${descriptor.join(' ')}` : ''}` : '';
        })
      );
      if (entries.some(Boolean)) image.setAttribute('srcset', entries.filter(Boolean).join(', '));
      else image.removeAttribute('srcset');
    }
  }

  for (const link of Array.from(doc.querySelectorAll('link[rel~="stylesheet"][href]'))) {
    const href = link.getAttribute('href') ?? '';
    const cssData = await resolveAsset(href);
    if (!cssData) {
      link.remove();
      continue;
    }
    const [, mime, base64] = cssData.match(/^data:([^;]+);base64,(.*)$/s) ?? [];
    if (!mime || !base64) {
      link.remove();
      continue;
    }
    const css = decodeBase64Utf8(base64);
    const cssPath = workspacePath(href, sourceDir);
    const cssDir = cssPath.slice(0, cssPath.lastIndexOf('/') + 1);
    const rewrittenCss = await rewriteCssUrls(css, cssDir, loadInlineAsset);
    const style = doc.createElement('style');
    style.textContent = rewrittenCss;
    link.replaceWith(style);
  }

  for (const style of Array.from(doc.querySelectorAll('style'))) {
    style.textContent = await rewriteCssUrls(style.textContent ?? '', sourceDir, loadInlineAsset);
  }
  for (const element of Array.from(doc.querySelectorAll('[style]'))) {
    element.setAttribute(
      'style',
      await rewriteCssUrls(element.getAttribute('style') ?? '', sourceDir, loadInlineAsset)
    );
  }

  doc.querySelectorAll('form[action]').forEach(form => form.removeAttribute('action'));
  doc.querySelectorAll('[src^="http"], [href^="http"], [action]').forEach(el => {
    if (el.matches('a[href]')) el.removeAttribute('href');
    else if (el.hasAttribute('src')) el.removeAttribute('src');
    else el.removeAttribute('action');
  });

  const csp = doc.createElement('meta');
  csp.httpEquiv = 'Content-Security-Policy';
  const nonce = createNonce();
  csp.content = `default-src 'none'; img-src data: blob:; media-src data: blob:; font-src data:; style-src 'unsafe-inline' data:; script-src 'nonce-${nonce}'; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'`;
  doc.head.prepend(csp);

  const bridge = doc.createElement('script');
  bridge.setAttribute('nonce', nonce);
  bridge.textContent = makeBridge(channel, baseRevision);
  doc.head.insertBefore(bridge, doc.head.children[1] ?? null);
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

function createNonce(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function normalizeWorkspacePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(decodeURIComponent(part));
  }
  return parts.join('/');
}

function workspacePath(raw: string, fromDir: string): string {
  const path = raw.split(/[?#]/, 1)[0];
  return normalizeWorkspacePath(path.startsWith('/') ? path : `${fromDir}${path}`);
}

function makeBridge(channel: string, baseRevision: string): string {
  const safeChannel = JSON.stringify(channel).replace(/</g, '\\u003c');
  const safeBaseRevision = JSON.stringify(baseRevision).replace(/</g, '\\u003c');
  const safeStyleKeys = JSON.stringify(BRIDGE_STYLE_KEYS);
  const safeAttrNames = JSON.stringify(BRIDGE_ATTR_NAMES);
  return `(() => {
    const channel=${safeChannel};
    const base=${safeBaseRevision};
    const styleKeys=${safeStyleKeys};
    const attrNames=${safeAttrNames};
    const identities = new WeakMap();
    let selected = null;
    let originalOutline = '';
    let originalOutlineOffset = '';
    const identityFor = element => {
      const known = identities.get(element);
      if (known) return known;
      const path = element.getAttribute('data-zclaudia-path');
      if (path === null) return null;
      try {
        const identity = {
          path: JSON.parse(path),
          text: element.getAttribute('data-zclaudia-source-text') || ''
        };
        if (!Array.isArray(identity.path)) return null;
        identities.set(element, identity);
        return identity;
      } catch {
        return null;
      }
    };
    document.addEventListener('DOMContentLoaded', () => {
      document.querySelectorAll('[data-zclaudia-path]').forEach(element => {
        try {
          identities.set(element, {
            path: JSON.parse(element.getAttribute('data-zclaudia-path')),
            text: element.getAttribute('data-zclaudia-source-text') || ''
          });
        } catch {}
        element.removeAttribute('data-zclaudia-path');
        element.removeAttribute('data-zclaudia-source-text');
      });
    }, { once: true });
    const selectElement = (node, path, sourceText) => {
      const inlineStyle = node.getAttribute('style');
      if (selected) {
        selected.style.outline = originalOutline;
        selected.style.outlineOffset = originalOutlineOffset;
      }
      selected = node;
      originalOutline = node.style.outline;
      originalOutlineOffset = node.style.outlineOffset;
      node.style.outline = '2px dashed #808080';
      node.style.outlineOffset = '3px';
      const computed = getComputedStyle(node);
      const selection = {
        elementPath: path,
        tagName: node.tagName.toLowerCase(),
        text: (node.textContent || '').trim().slice(0, 2000),
        color: computed.color,
        backgroundColor: computed.backgroundColor,
        base
      };
      if (typeof sourceText === 'string') selection.sourceText = sourceText;
      const styles = {};
      for (const key of styleKeys) {
        const value = computed[key];
        if (value) styles[key] = String(value).slice(0, 120);
      }
      if (Object.keys(styles).length > 0) selection.styles = styles;
      const attrs = {};
      for (const name of attrNames) {
        const value = node.getAttribute(name);
        if (value !== null) attrs[name] = String(value).slice(0, 500);
      }
      if (Object.keys(attrs).length > 0) selection.attrs = attrs;
      const inlineStyleValue = inlineStyle === null ? null : String(inlineStyle).slice(0, 2000);
      if (inlineStyleValue !== null) selection.inlineStyle = inlineStyleValue;
      parent.postMessage({ type:'zclaudia:design-select', channel, selection }, '*');
    };
    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      if (target.closest('a')) event.preventDefault();
      const identity = identityFor(target);
      if (!identity) return;
      selectElement(target, identity.path, identity.text);
    }, true);
    document.addEventListener('submit', event => event.preventDefault(), true);
    window.addEventListener('message', event => {
      const data = event.data;
      if (
        !data ||
        (data.type !== 'zclaudia:design-verify' && data.type !== 'zclaudia:design-select-path') ||
        data.channel !== channel
      )
        return;
      const path = Array.isArray(data.elementPath) ? data.elementPath : null;
      if (!path || path.length > 64 || !path.every(step => Number.isInteger(step) && step >= 0)) return;
      let node = document.body;
      for (const step of path) {
        if (!node) break;
        node = node.children[step] ?? null;
      }
      if (!node) {
        if (data.type === 'zclaudia:design-select-path') {
          parent.postMessage({ type:'zclaudia:design-select-failed', channel, reason:'not-found' }, '*');
        }
        return;
      }
      if (data.type === 'zclaudia:design-select-path') {
        selectElement(node, path, undefined);
        return;
      }
      const style = getComputedStyle(node);
      parent.postMessage({
        type:'zclaudia:design-verify-result', channel,
        elementPath: path,
        color: style.color,
        backgroundColor: style.backgroundColor
      }, '*');
    });
  })();`;
}

function markStaticElements(
  parent: Element,
  path: number[],
  state = { marked: 0, visited: 0 }
): void {
  if (
    path.length >= 128 ||
    state.marked >= MAX_MARKED_ELEMENTS ||
    state.visited >= MAX_VISITED_ELEMENTS
  )
    return;
  Array.from(parent.children).forEach((element, index) => {
    if (state.marked >= MAX_MARKED_ELEMENTS || state.visited >= MAX_VISITED_ELEMENTS) return;
    state.visited += 1;
    const elementPath = [...path, index];
    const sourceText = (element.textContent ?? '').trim();
    if (sourceText.length <= MAX_SELECTION_TEXT_LENGTH) {
      element.setAttribute('data-zclaudia-path', JSON.stringify(elementPath));
      element.setAttribute('data-zclaudia-source-text', sourceText);
      state.marked += 1;
    }
    markStaticElements(element, elementPath, state);
  });
}

async function rewriteCssUrls(
  css: string,
  fromDir: string,
  loadAsset: (relativeWorkspacePath: string) => Promise<string | null>
): Promise<string> {
  const matches = [...css.matchAll(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi)];
  let result = css;
  for (const match of matches.reverse()) {
    const raw = match[2];
    if (/^(?:data:|blob:|#)/i.test(raw)) continue;
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(raw)) {
      result =
        result.slice(0, match.index) + 'url("")' + result.slice(match.index! + match[0].length);
      continue;
    }
    const dataUrl = await loadAsset(workspacePath(raw, fromDir));
    const replacement = dataUrl ? `url("${dataUrl}")` : 'url("")';
    result =
      result.slice(0, match.index) + replacement + result.slice(match.index! + match[0].length);
  }
  return result;
}

function decodeBase64Utf8(base64: string): string {
  const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
