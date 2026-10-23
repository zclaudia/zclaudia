import type { DesignAttributeName, DesignStyleProperty } from '../types';

const SAFE_COLOR_NAMES = new Set([
  'transparent',
  'currentcolor',
  'black',
  'white',
  'red',
  'green',
  'blue',
  'yellow',
  'orange',
  'purple',
  'pink',
  'gray',
  'grey',
  'silver',
  'navy',
  'teal',
  'maroon',
  'olive',
  'lime',
  'aqua',
  'fuchsia',
  'rebeccapurple',
]);

/** Whitelist a user-provided color value. Returns the trimmed value, or null when unsafe. */
export function safeColor(value: string): string | null {
  const color = value.trim();
  if (!color || color.length > 80 || /[;{}<>\\]|url\s*\(|var\s*\(|expression/i.test(color))
    return null;
  if (
    /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(color) ||
    SAFE_COLOR_NAMES.has(color.toLowerCase())
  )
    return color;
  if (/^(?:rgb|rgba|hsl|hsla)\([\d.%\s,+/-]+\)$/i.test(color)) return color;
  return null;
}

// ---------------------------------------------------------------------------
// P3 style property whitelist (§2.1)
// ---------------------------------------------------------------------------

const COLOR_PROPERTIES = new Set<DesignStyleProperty>(['color', 'background-color', 'border-color']);

const LENGTH_UNITS = 'px|em|rem|%|vh|vw|vmin|vmax|ch|ex|pt|pc|cm|mm|q|in';
/** `±number+unit` with ≤4 integer digits and ≤3 fraction digits. */
const LENGTH_TOKEN = new RegExp(`^[+-]?\\d{1,4}(?:\\.\\d{1,3})?(?:${LENGTH_UNITS})$`, 'i');
const LENGTH_NUMBER = /^[+-]?\d{1,4}(?:\.\d{1,3})?/;

interface LengthOptions {
  allowNegative: boolean;
  allowAuto: boolean;
  maxAbsolute: number;
  /** 1–4 space-separated tokens (margin/padding/border-width/border-radius shorthand). */
  multi: boolean;
}

const LENGTH_OPTIONS: Partial<Record<DesignStyleProperty, LengthOptions>> = {
  'font-size': { allowNegative: false, allowAuto: false, maxAbsolute: 1000, multi: false },
  width: { allowNegative: false, allowAuto: true, maxAbsolute: 10000, multi: false },
  height: { allowNegative: false, allowAuto: true, maxAbsolute: 10000, multi: false },
  margin: { allowNegative: true, allowAuto: true, maxAbsolute: 10000, multi: true },
  'margin-top': { allowNegative: true, allowAuto: true, maxAbsolute: 10000, multi: false },
  'margin-right': { allowNegative: true, allowAuto: true, maxAbsolute: 10000, multi: false },
  'margin-bottom': { allowNegative: true, allowAuto: true, maxAbsolute: 10000, multi: false },
  'margin-left': { allowNegative: true, allowAuto: true, maxAbsolute: 10000, multi: false },
  padding: { allowNegative: false, allowAuto: false, maxAbsolute: 10000, multi: true },
  'padding-top': { allowNegative: false, allowAuto: false, maxAbsolute: 10000, multi: false },
  'padding-right': { allowNegative: false, allowAuto: false, maxAbsolute: 10000, multi: false },
  'padding-bottom': { allowNegative: false, allowAuto: false, maxAbsolute: 10000, multi: false },
  'padding-left': { allowNegative: false, allowAuto: false, maxAbsolute: 10000, multi: false },
  'border-width': { allowNegative: false, allowAuto: false, maxAbsolute: 10000, multi: true },
  'border-radius': { allowNegative: false, allowAuto: false, maxAbsolute: 10000, multi: true },
};

const KEYWORD_PROPERTIES: Partial<Record<DesignStyleProperty, string[]>> = {
  'text-align': ['left', 'right', 'center', 'justify', 'start', 'end'],
  'border-style': ['none', 'hidden', 'solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'inset', 'outset'],
  'object-fit': ['fill', 'contain', 'cover', 'none', 'scale-down'],
};

const FONT_WEIGHT_KEYWORDS = ['normal', 'bold', 'bolder', 'lighter'];

function safeLengthToken(token: string, options: LengthOptions): string | null {
  if (options.allowAuto && token.toLowerCase() === 'auto') return token;
  if (token === '0') return token;
  if (!LENGTH_TOKEN.test(token)) return null;
  const numeric = parseFloat(LENGTH_NUMBER.exec(token)?.[0] ?? '');
  if (!Number.isFinite(numeric)) return null;
  if (!options.allowNegative && numeric < 0) return null;
  if (Math.abs(numeric) > options.maxAbsolute) return null;
  return token;
}

function safeLengthValue(value: string, options: LengthOptions): string | null {
  if (!options.multi) return safeLengthToken(value, options);
  const tokens = value.split(/\s+/);
  if (tokens.length > 4) return null;
  for (const token of tokens) {
    if (safeLengthToken(token, options) === null) return null;
  }
  return value;
}

function safeLineHeight(value: string): string | null {
  if (value.toLowerCase() === 'normal') return value;
  if (/^\d{1,2}(?:\.\d{1,3})?$/.test(value)) {
    const numeric = parseFloat(value);
    return numeric >= 0.1 && numeric <= 10 ? value : null;
  }
  if (value === '0') return null; // a *positive* length is required
  if (safeLengthToken(value, { allowNegative: false, allowAuto: false, maxAbsolute: 10000, multi: false }) === null)
    return null;
  const numeric = parseFloat(LENGTH_NUMBER.exec(value)?.[0] ?? '');
  return Number.isFinite(numeric) && numeric > 0 ? value : null;
}

function safeFontWeight(value: string): string | null {
  if (FONT_WEIGHT_KEYWORDS.includes(value.toLowerCase())) return value;
  if (!/^\d+$/.test(value)) return null;
  const numeric = parseInt(value, 10);
  return numeric >= 100 && numeric <= 900 ? value : null;
}

function safeFontFamily(value: string): string | null {
  if (/[;{}<>\\]|url\s*\(|var\s*\(|expression/i.test(value)) return null;
  return value;
}

/**
 * 校验一个白名单属性的 inline 值。返回规整后的值或 null（非法）。
 *
 * 规则（设计文档 §2.1）：统一 trim、拒绝空串与 >120 字符；颜色走 safeColor；
 * 长度按单位与数值范围校验（margin/padding/border-width/border-radius 额外
 * 接受 1–4 个空格分隔的多值简写）；关键字属性走各自白名单；font-family
 * 拒绝注入字符。关键词与单位大小写不敏感，返回值保留原文拼写。
 */
export function safeStyleValue(property: DesignStyleProperty, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120) return null;
  if (COLOR_PROPERTIES.has(property)) return safeColor(trimmed);
  if (property === 'font-family') return safeFontFamily(trimmed);
  if (property === 'line-height') return safeLineHeight(trimmed);
  if (property === 'font-weight') return safeFontWeight(trimmed);
  const keywords = KEYWORD_PROPERTIES[property];
  if (keywords) return keywords.includes(trimmed.toLowerCase()) ? trimmed : null;
  const options = LENGTH_OPTIONS[property];
  if (options) return safeLengthValue(trimmed, options);
  return null;
}

// ---------------------------------------------------------------------------
// P3 element attribute whitelist (§3.2)
// ---------------------------------------------------------------------------

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'avif']);
const URL_SCHEME = /^[a-z][a-z\d+.-]*:/i;
const DANGEROUS_SCHEME = /^(?:javascript|data|vbscript):/i;

/** C0 control characters (U+0000–U+001F) and DEL. */
function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * 校验元素属性值（name 已由引擎限白名单与标签）。返回规整值或 null。
 *
 * 规则（设计文档 §3.2）：src/alt 仅 img、href 仅 a（大小写不敏感）；
 * src 非空 ≤500、禁 scheme 与 `//` 前缀、禁反斜杠/控制字符/首尾空白、
 * 扩展名白名单（先剥 #fragment/?query）；alt ≤500 任意非控制字符文本；
 * href ≤2000，拒绝 javascript:/data:/vbscript:（大小写不敏感）与控制字符。
 */
export function safeAttrValue(name: DesignAttributeName, value: string, tagName: string): string | null {
  const tag = tagName.toLowerCase();
  if (name === 'href' ? tag !== 'a' : tag !== 'img') return null;

  if (name === 'src') {
    if (!value || value.length > 500) return null;
    if (/^\s|\s$/.test(value)) return null;
    if (value.includes('\\') || hasControlChars(value)) return null;
    if (URL_SCHEME.test(value) || value.startsWith('//')) return null;
    const path = value.split('#')[0].split('?')[0];
    const extension = /\.([a-z\d]+)$/i.exec(path)?.[1]?.toLowerCase();
    if (!extension || !IMAGE_EXTENSIONS.has(extension)) return null;
    return value;
  }

  if (name === 'alt') {
    if (value.length > 500 || hasControlChars(value)) return null;
    return value;
  }

  // href
  if (value.length > 2000 || hasControlChars(value)) return null;
  if (DANGEROUS_SCHEME.test(value)) return null;
  return value;
}

/** Escape a value for insertion as element text: & < > become entities. */
export function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escape a value for insertion inside a double-quoted attribute: & and " become entities. */
export function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
