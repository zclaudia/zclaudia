/** Creates a sandbox-ready static HTML/CSS srcdoc. Local assets are inlined; scripts are not run. */
import {
  STYLE_IMPORTANT_PROPS_MAX,
  STYLE_RULES_MAX,
  STYLE_RULE_SELECTOR_MAX,
  STYLE_SPECIFICITY_MAX,
} from './types';

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

/** P3.5 §1 来源标记属性：`@inline/<n>` 或工作区相对 CSS 路径；仅存在于预览 DOM，不写入作品文件。 */
const STYLE_ORIGIN_ATTRIBUTE = 'data-zclaudia-style-origin';

/** 桥内生效规则枚举的上限与标记属性（§2；数值取 types.ts 契约常量，随桥接脚本注入）。 */
const BRIDGE_RULE_LIMITS = {
  originAttribute: STYLE_ORIGIN_ATTRIBUTE,
  rulesMax: STYLE_RULES_MAX,
  selectorMax: STYLE_RULE_SELECTOR_MAX,
  specificityMax: STYLE_SPECIFICITY_MAX,
  importantPropsMax: STYLE_IMPORTANT_PROPS_MAX,
};

/** 资产内联加载器：静态/运行两种预览构建共用（P5.2 §2.1 增量导出）。 */
export interface AssetInlineLoader {
  /** 工作区相对路径 → data URL；超限/失败 → null。上限沿用 MAX_ASSETS/MAX_ASSET_BYTES/MAX_TOTAL_ASSET_BYTES。 */
  loadInlineAsset(path: string): Promise<string | null>;
  /** 原始引用值 → data URL（data:/blob:/#/scheme 原样返回 null）。 */
  resolveAsset(raw: string, fromDir?: string): Promise<string | null>;
}

/** 创建资产内联加载器；同一实例内按路径缓存并共享总量预算。 */
export function createAssetInlineLoader(
  loadAsset: (relativeWorkspacePath: string) => Promise<{ mimeType: string; data: string }>
): AssetInlineLoader {
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
  const resolveAsset = async (raw: string, fromDir = ''): Promise<string | null> => {
    const value = raw.trim();
    if (!value || /^(?:data:|blob:|#|\/\/)/i.test(value) || /^[a-z][a-z\d+.-]*:/i.test(value))
      return null;
    return loadInlineAsset(workspacePath(value, fromDir));
  };
  return { loadInlineAsset, resolveAsset };
}

/** 工作区文件路径 → 所在目录（含末尾斜杠；根级文件 → ''）。 */
export function workspaceSourceDir(filePath: string): string {
  const sourcePath = normalizeWorkspacePath(filePath);
  return sourcePath.slice(0, sourcePath.lastIndexOf('/') + 1);
}

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

  const sourceDir = workspaceSourceDir(filePath);
  const { loadInlineAsset, resolveAsset } = createAssetInlineLoader(loadAsset);

  for (const image of Array.from(doc.querySelectorAll('img'))) {
    const src = image.getAttribute('src');
    if (src) {
      const inlined = await resolveAsset(src, sourceDir);
      if (inlined) image.setAttribute('src', inlined);
      else if (!/^(?:data:|blob:)/i.test(src)) image.removeAttribute('src');
    }
    const srcset = image.getAttribute('srcset');
    if (srcset) {
      const entries = await Promise.all(
        srcset.split(',').map(async entry => {
          const [url, ...descriptor] = entry.trim().split(/\s+/);
          const inlined = await resolveAsset(url, sourceDir);
          return inlined ? `${inlined}${descriptor.length ? ` ${descriptor.join(' ')}` : ''}` : '';
        })
      );
      if (entries.some(Boolean)) image.setAttribute('srcset', entries.filter(Boolean).join(', '));
      else image.removeAttribute('srcset');
    }
  }

  await inlineStyleSources(doc, sourceDir, { loadInlineAsset, resolveAsset });

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
  const safeRuleLimits = JSON.stringify(BRIDGE_RULE_LIMITS);
  return `(() => {
    const channel=${safeChannel};
    const base=${safeBaseRevision};
    const styleKeys=${safeStyleKeys};
    const attrNames=${safeAttrNames};
    const ruleLimits=${safeRuleLimits};
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
    // ---- P3.5 §2 生效规则枚举：浏览器做选择器匹配（el.matches），宿主只做身份对齐 ----
    const pseudoElementNames = { before: true, after: true, 'first-line': true, 'first-letter': true };
    // 选择器组按逗号拆分（括号/引号感知，反斜杠转义跳过）。
    const splitSelectorList = text => {
      const parts = [];
      let depth = 0;
      let quote = '';
      let start = 0;
      for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (quote) {
          if (ch === '\\\\') i += 1;
          else if (ch === quote) quote = '';
          continue;
        }
        if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '(') depth += 1;
        else if (ch === ')') depth = Math.max(0, depth - 1);
        else if (ch === ',' && depth === 0) {
          parts.push(text.slice(start, i));
          start = i + 1;
        }
      }
      parts.push(text.slice(start));
      return parts.map(part => part.trim()).filter(Boolean);
    };
    // 复合选择器按组合符（空格 > + ~）拆分，括号与引号内容不拆。
    const splitCompounds = selector => {
      const compounds = [];
      let depth = 0;
      let quote = '';
      let start = 0;
      for (let i = 0; i < selector.length; i += 1) {
        const ch = selector[i];
        if (quote) {
          if (ch === '\\\\') i += 1;
          else if (ch === quote) quote = '';
          continue;
        }
        if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '(') depth += 1;
        else if (ch === ')') depth = Math.max(0, depth - 1);
        else if (depth === 0 && (ch === ' ' || ch === '>' || ch === '+' || ch === '~')) {
          const piece = selector.slice(start, i).trim();
          if (piece) compounds.push(piece);
          while (
            i + 1 < selector.length &&
            (selector[i + 1] === ' ' ||
              selector[i + 1] === '>' ||
              selector[i + 1] === '+' ||
              selector[i + 1] === '~')
          )
            i += 1;
          start = i + 1;
        }
      }
      const rest = selector.slice(start).trim();
      if (rest) compounds.push(rest);
      return compounds;
    };
    const identLength = text => {
      let i = 0;
      while (i < text.length) {
        const ch = text[i];
        if (ch === '\\\\') {
          i += 2;
          continue;
        }
        if (/[A-Za-z0-9_-]/.test(ch) || text.charCodeAt(i) > 127) {
          i += 1;
          continue;
        }
        break;
      }
      return i;
    };
    const attributeLength = text => {
      let quote = '';
      for (let i = 1; i < text.length; i += 1) {
        const ch = text[i];
        if (quote) {
          if (ch === '\\\\') i += 1;
          else if (ch === quote) quote = '';
          continue;
        }
        if (ch === '"' || ch === "'") quote = ch;
        else if (ch === ']') return i + 1;
      }
      return text.length;
    };
    const parenClose = (text, open) => {
      let depth = 0;
      let quote = '';
      for (let i = open; i < text.length; i += 1) {
        const ch = text[i];
        if (quote) {
          if (ch === '\\\\') i += 1;
          else if (ch === quote) quote = '';
          continue;
        }
        if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '(') depth += 1;
        else if (ch === ')') {
          depth -= 1;
          if (depth === 0) return i;
        }
      }
      return text.length;
    };
    // 单个复合选择器的特异性：:not()/:is() 参数取最specificity递归计入，伪元素按元素位计，:where() 计 0。
    const compoundSpecificity = compound => {
      const spec = [0, 0, 0];
      let i = 0;
      while (i < compound.length) {
        const ch = compound[i];
        if (ch === '\\\\') {
          i += 2;
          continue;
        }
        if (ch === '#') {
          spec[0] += 1;
          i += 1 + identLength(compound.slice(i + 1));
          continue;
        }
        if (ch === '.') {
          spec[1] += 1;
          i += 1 + identLength(compound.slice(i + 1));
          continue;
        }
        if (ch === '[') {
          spec[1] += 1;
          i += attributeLength(compound.slice(i));
          continue;
        }
        if (ch === ':') {
          let j = i + 1;
          let explicitElement = false;
          if (compound[j] === ':') {
            explicitElement = true;
            j += 1;
          }
          const nameStart = j;
          while (j < compound.length && /[A-Za-z0-9_-]/.test(compound[j])) j += 1;
          const name = compound.slice(nameStart, j).toLowerCase();
          let args = null;
          if (compound[j] === '(') {
            const close = parenClose(compound, j);
            args = compound.slice(j + 1, close);
            j = close + 1;
          }
          i = j;
          if (explicitElement || pseudoElementNames[name]) spec[2] += 1;
          else if (
            name === 'not' ||
            name === 'is' ||
            name === 'matches' ||
            name === 'any' ||
            name === '-webkit-any' ||
            name === '-moz-any'
          ) {
            const argSpec = maxArgumentSpecificity(args === null ? '' : args);
            spec[0] += argSpec[0];
            spec[1] += argSpec[1];
            spec[2] += argSpec[2];
          } else if (name !== 'where') spec[1] += 1;
          continue;
        }
        if (/[A-Za-z_]/.test(ch) || compound.charCodeAt(i) > 127) {
          spec[2] += 1;
          i += identLength(compound.slice(i));
          continue;
        }
        i += 1; // '*'、空白与其他容错字符不计特异性
      }
      return spec;
    };
    const maxArgumentSpecificity = args => {
      let best = [0, 0, 0];
      for (const part of splitSelectorList(args)) {
        const candidate = selectorSpecificity(part);
        if (
          candidate[0] > best[0] ||
          (candidate[0] === best[0] &&
            (candidate[1] > best[1] || (candidate[1] === best[1] && candidate[2] > best[2])))
        )
          best = candidate;
      }
      return best;
    };
    const selectorSpecificity = selector => {
      const total = [0, 0, 0];
      for (const compound of splitCompounds(selector)) {
        const spec = compoundSpecificity(compound);
        total[0] += spec[0];
        total[1] += spec[1];
        total[2] += spec[2];
      }
      return total;
    };
    const capSpecificity = value => Math.min(value, ruleLimits.specificityMax);
    // 遍历 styleSheets → ownerNode 来源标记（缺失跳过）→ 递归展开分组规则 → 逐选择器 matches → 命中上报。
    const collectStyleRules = (node, elementPath) => {
      const rules = [];
      let truncated = false;
      const visitList = (ruleList, parentPath, origin) => {
        for (let index = 0; index < ruleList.length; index += 1) {
          if (rules.length >= ruleLimits.rulesMax) {
            truncated = true;
            return;
          }
          const rule = ruleList[index];
          const rulePath = parentPath.concat([index]);
          if (rule.selectorText && rule.style) {
            const declarations = rule.style;
            const importantProps = [];
            for (
              let p = 0;
              p < declarations.length && importantProps.length < ruleLimits.importantPropsMax;
              p += 1
            ) {
              const property = declarations[p];
              if (declarations.getPropertyPriority(property) === 'important')
                importantProps.push(property);
            }
            for (const selector of splitSelectorList(rule.selectorText)) {
              if (rules.length >= ruleLimits.rulesMax) {
                truncated = true;
                return;
              }
              let matched = false;
              try {
                matched = node.matches(selector);
              } catch {
                matched = false;
              }
              if (!matched) continue;
              const spec = selectorSpecificity(selector);
              rules.push({
                origin: origin,
                rulePath: rulePath,
                selectorText: selector.slice(0, ruleLimits.selectorMax),
                specificity: [
                  capSpecificity(spec[0]),
                  capSpecificity(spec[1]),
                  capSpecificity(spec[2])
                ],
                importantProps: importantProps
              });
            }
          } else if (rule.cssRules) {
            visitList(rule.cssRules, rulePath, origin);
            if (truncated) return;
          }
        }
      };
      const sheets = document.styleSheets;
      for (let s = 0; s < sheets.length; s += 1) {
        const sheet = sheets[s];
        const owner = sheet.ownerNode;
        const origin =
          owner && typeof owner.getAttribute === 'function'
            ? owner.getAttribute(ruleLimits.originAttribute)
            : null;
        if (!origin) continue;
        if (rules.length >= ruleLimits.rulesMax) {
          truncated = true;
          break;
        }
        let ruleList = null;
        try {
          ruleList = sheet.cssRules;
        } catch {
          ruleList = null;
        }
        if (!ruleList) continue;
        visitList(ruleList, [], origin);
        if (truncated) break;
      }
      const message = { type:'zclaudia:design-rules', channel, elementPath, rules };
      if (truncated) message.truncated = true;
      parent.postMessage(message, '*');
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
      if (event.source === parent && data && data.channel === channel &&
          data.type === 'zclaudia:design-ping' && typeof data.token === 'string' && data.token.length <= 100) {
        parent.postMessage({ type:'zclaudia:design-ready', channel, base, token:data.token }, '*');
        return;
      }
      if (
        !data ||
        (data.type !== 'zclaudia:design-verify' &&
          data.type !== 'zclaudia:design-select-path' &&
          data.type !== 'zclaudia:design-rules-request') ||
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
        // rules-request 与 verify 同口径：解析失败静默（宿主按超时清空处理）。
        return;
      }
      if (data.type === 'zclaudia:design-select-path') {
        selectElement(node, path, undefined);
        return;
      }
      if (data.type === 'zclaudia:design-rules-request') {
        collectStyleRules(node, path);
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

/**
 * P3.5 §1 样式来源内联（静态/运行两构建器共用）：
 * link[stylesheet] → <style> 并打 data-zclaudia-style-origin=工作区相对 CSS 路径；
 * 入口自有 <style> 块（无标记者，link 替换发生在前）按文档序打 @inline/<n>（n 从 0 起）；
 * 随后改写全部 <style> 与 [style] 的 url() 为 data URL。来源属性仅供桥内规则枚举，不写入作品文件。
 */
export async function inlineStyleSources(
  doc: Document,
  sourceDir: string,
  loader: AssetInlineLoader
): Promise<void> {
  for (const link of Array.from(doc.querySelectorAll('link[rel~="stylesheet"][href]'))) {
    const href = link.getAttribute('href') ?? '';
    const cssData = await loader.resolveAsset(href, sourceDir);
    if (!cssData) {
      link.remove();
      continue;
    }
    const [, mime, base64] = cssData.match(/^data:([^;]+);base64,(.*)$/s) ?? [];
    if (!mime || !base64) {
      link.remove();
      continue;
    }
    const cssPath = workspacePath(href, sourceDir);
    const cssDir = cssPath.slice(0, cssPath.lastIndexOf('/') + 1);
    const style = doc.createElement('style');
    style.setAttribute(STYLE_ORIGIN_ATTRIBUTE, cssPath);
    style.textContent = await rewriteCssUrls(decodeBase64Utf8(base64), cssDir, loader.loadInlineAsset);
    link.replaceWith(style);
  }
  let inlineOrdinal = 0;
  for (const style of Array.from(doc.querySelectorAll('style'))) {
    if (!style.hasAttribute(STYLE_ORIGIN_ATTRIBUTE)) {
      style.setAttribute(STYLE_ORIGIN_ATTRIBUTE, `@inline/${inlineOrdinal}`);
      inlineOrdinal += 1;
    }
  }
  for (const style of Array.from(doc.querySelectorAll('style'))) {
    style.textContent = await rewriteCssUrls(
      style.textContent ?? '',
      sourceDir,
      loader.loadInlineAsset
    );
  }
  for (const element of Array.from(doc.querySelectorAll('[style]'))) {
    element.setAttribute(
      'style',
      await rewriteCssUrls(element.getAttribute('style') ?? '', sourceDir, loader.loadInlineAsset)
    );
  }
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

/** base64 → UTF-8 文本（本地脚本/样式内联共用）。 */
export function decodeBase64Utf8(base64: string): string {
  const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
