/**
 * P5.3 演示文稿纯逻辑（设计文档 §3）。deck 约定：源码内任意元素带
 * `data-zclaudia-slide` 即一页（文档顺序 = 页序），可选 `data-title` /
 * `data-notes`；比例存 `<body data-zclaudia-deck-ratio="16:9|4:3">`。
 * 全部结构操作经 html/parse.ts 的源码范围做字符串拼接，块外字节零改动。
 */
import { DesignEditError } from './types';
import {
  attributeSpan,
  attrValue,
  childElements,
  elementSpan,
  newAttributeInsertOffset,
  parseDocument,
  type P5Element,
  type P5ParentNode,
  type ParsedDocument,
} from './html/parse';

export type DeckRatio = '16:9' | '4:3';

/** 捕获/播放的逻辑像素尺寸（96dpi 口径）。 */
export const DECK_RATIO_DIMENSIONS: Record<DeckRatio, { width: number; height: number }> = {
  '16:9': { width: 1600, height: 900 },
  '4:3': { width: 1200, height: 900 },
};

/** 含标签的整元素源码范围。 */
export interface DeckSlideSpan {
  start: number;
  end: number;
}

export interface DeckSlide {
  index: number;
  /** 从 body 子元素起的元素序号路径（与选区/树口径一致）。 */
  elementPath: number[];
  title: string;
  notes: string;
  tagName: string;
  span: DeckSlideSpan;
}

export interface DeckInfo {
  slides: DeckSlide[];
  ratio: DeckRatio;
  siblings: boolean;
}

const SLIDE_ATTRIBUTE = 'data-zclaudia-slide';
const TITLE_ATTRIBUTE = 'data-title';
const NOTES_ATTRIBUTE = 'data-notes';
const RATIO_ATTRIBUTE = 'data-zclaudia-deck-ratio';

const MAX_SLIDES = 60;
const MAX_TITLE_LENGTH = 200;
const MAX_NOTES_LENGTH = 2000;
/** 遍历上限（对齐 element-tree）。 */
const MAX_VISITED_NODES = 10000;
const MAX_TREE_DEPTH = 128;

interface SlideHit {
  element: P5Element;
  /** 从 body 子元素起的元素序号路径。 */
  path: number[];
  /** 含标签的整元素源码范围。 */
  span: DeckSlideSpan;
}

interface ParsedDeck {
  info: DeckInfo;
  parsed: ParsedDocument;
  /** 真实 body 元素（parseDeckInternal 已保证带源码位置）。 */
  body: P5Element;
  /** 与 info.slides 平行的元素引用（attributeSpan 等需要元素而非 span）。 */
  elements: P5Element[];
}

/** C0 控制字符（U+0000–U+001F）与 DEL。 */
function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** 属性值写入转义（§3.2）：" & < > 转义；读回时实体解码还原原值。 */
function escapeAttrValue(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function isSlideElement(element: P5Element): boolean {
  return attrValue(element, SLIDE_ATTRIBUTE) !== undefined;
}

/** 解析 deck；无真实 body（缺失或隐式创建）视为解析失败。 */
function parseDeckInternal(source: string): ParsedDeck {
  const parsed = parseDocument(source);
  const body = parsed.body;
  if (!body || !body.sourceCodeLocation) {
    throw new DesignEditError('MALFORMED_HTML', '页面缺少可解析的 body 元素');
  }

  const hits: SlideHit[] = [];
  let visited = 0;
  const walk = (parent: P5ParentNode, parentPath: number[]): void => {
    if (visited >= MAX_VISITED_NODES || parentPath.length >= MAX_TREE_DEPTH) return;
    for (const [index, element] of childElements(parent).entries()) {
      if (visited >= MAX_VISITED_NODES) return;
      visited += 1;
      const path = [...parentPath, index];
      if (isSlideElement(element)) {
        const span = elementSpan(element);
        if (!span) {
          throw new DesignEditError('MALFORMED_HTML', '幻灯片元素缺少源码位置');
        }
        if (parsed.errors.some(error => error.startOffset >= span.start && error.startOffset < span.end)) {
          throw new DesignEditError('MALFORMED_HTML', '幻灯片元素包含解析错误');
        }
        hits.push({ element, path, span });
      }
      walk(element, path);
    }
  };
  walk(body, []);

  if (hits.length > MAX_SLIDES) {
    throw new DesignEditError('STRUCTURE_NOT_ALLOWED', '幻灯片数量超过 60 页上限');
  }

  const slides: DeckSlide[] = hits.map(({ element, path, span }, index) => {
    const rawTitle = attrValue(element, TITLE_ATTRIBUTE);
    return {
      index,
      elementPath: path,
      title: rawTitle ? rawTitle : `第 ${index + 1} 页`,
      notes: attrValue(element, NOTES_ATTRIBUTE) ?? '',
      tagName: element.tagName.toLowerCase(),
      span,
    };
  });
  const elements = hits.map(hit => hit.element);

  const rawRatio = attrValue(body, RATIO_ATTRIBUTE);
  const ratio: DeckRatio = rawRatio === '4:3' ? '4:3' : '16:9';
  const firstPath = slides[0]?.elementPath;
  const siblings = slides.every(slide =>
    sameParentPrefix(slide.elementPath, firstPath ?? slide.elementPath)
  );

  return { info: { slides, ratio, siblings }, parsed, body, elements };
}

/** 同父级判定：路径去掉末位序号后完全一致。 */
function sameParentPrefix(path: number[], other: number[]): boolean {
  if (path.length !== other.length) return false;
  for (let i = 0; i < path.length - 1; i += 1) {
    if (path[i] !== other[i]) return false;
  }
  return true;
}

/**
 * 解析 deck 结构：标记元素（文档序）、比例、可排序性。解析失败抛
 * MALFORMED_HTML；标记元素超过 60 抛 STRUCTURE_NOT_ALLOWED。
 */
export function parseDeck(source: string): DeckInfo {
  return parseDeckInternal(source).info;
}

/** parseDeck 成功且至少含一页。 */
export function isDeck(source: string): boolean {
  try {
    return parseDeck(source).slides.length > 0;
  } catch {
    return false;
  }
}

function slideAt(info: DeckInfo, index: number): DeckSlide {
  const slide = Number.isSafeInteger(index) ? info.slides[index] : undefined;
  if (!slide) {
    throw new DesignEditError('INVALID_VALUE', '幻灯片序号越界');
  }
  return slide;
}

/**
 * 幻灯片重排（from → to）。越界抛 INVALID_VALUE；非同父级抛
 * STRUCTURE_NOT_ALLOWED。实现 = 源码块 [start,end) 拼接搬移，两块之外的
 * 字节（含夹在中间的非 slide 兄弟节点与注释）逐字节不变。
 */
export function reorderDeckSlides(source: string, from: number, to: number): string {
  const info = parseDeck(source);
  const fromSlide = slideAt(info, from);
  const toSlide = slideAt(info, to);
  if (!info.siblings) {
    throw new DesignEditError('STRUCTURE_NOT_ALLOWED', '幻灯片不在同一父级，无法排序');
  }
  if (from === to) return source;
  const fromSpan = fromSlide.span;
  const toSpan = toSlide.span;
  if (from < to) {
    if (toSpan.start < fromSpan.end) {
      throw new DesignEditError('MALFORMED_HTML', '幻灯片元素源码范围异常重叠');
    }
    // 区间 [from.start, to.end) → 中间字节 + 目标块 + 来源块。
    return (
      source.slice(0, fromSpan.start) +
      source.slice(fromSpan.end, toSpan.start) +
      source.slice(toSpan.start, toSpan.end) +
      source.slice(fromSpan.start, fromSpan.end) +
      source.slice(toSpan.end)
    );
  }
  if (fromSpan.start < toSpan.end) {
    throw new DesignEditError('MALFORMED_HTML', '幻灯片元素源码范围异常重叠');
  }
  // 区间 [to.start, from.end) → 来源块 + 中间字节 + 目标块。
  return (
    source.slice(0, toSpan.start) +
    source.slice(fromSpan.start, fromSpan.end) +
    source.slice(toSpan.end, fromSpan.start) +
    source.slice(toSpan.start, toSpan.end) +
    source.slice(fromSpan.end)
  );
}

/** 元素在源码中所在行的缩进；起始不在行首（或行首非纯空白）时回退两空格。 */
function indentOf(source: string, offset: number): string {
  const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
  const prefix = source.slice(lineStart, offset);
  return /^[ \t]*$/.test(prefix) ? prefix : '  ';
}

/** §3.2 新页模板：外层对齐既有缩进，内层再进两格。 */
function slideTemplate(indent: string): string {
  const childIndent = `${indent}  `;
  return [
    `${indent}<section data-zclaudia-slide data-title="新页">`,
    `${childIndent}<h2>新页标题</h2>`,
    `${childIndent}<p>在此填写内容。</p>`,
    `${indent}</section>`,
  ].join('\n');
}

/**
 * `</body>` 前追加模板页（推荐结构下与最后一页同父级；无 body 或解析失败
 * 抛错）。有既有页时对齐其缩进，无则两空格；已达 60 页上限抛
 * STRUCTURE_NOT_ALLOWED。返回新页的 0 基序号。
 */
export function addDeckSlide(source: string): { source: string; index: number } {
  const deck = parseDeckInternal(source);
  const info = deck.info;
  if (info.slides.length >= MAX_SLIDES) {
    throw new DesignEditError('STRUCTURE_NOT_ALLOWED', '幻灯片数量超过 60 页上限');
  }
  const body = deck.body;
  const bodySpan = elementSpan(body);
  if (!bodySpan) {
    throw new DesignEditError('MALFORMED_HTML', 'body 元素缺少源码位置');
  }
  const endTag = body.sourceCodeLocation?.endTag;
  let insertOffset = endTag ? endTag.startOffset : bodySpan.end;

  const lastSlide = info.slides[info.slides.length - 1];
  const indent = lastSlide ? indentOf(source, lastSlide.span.start) : '  ';
  const template = slideTemplate(indent);

  // 插入点前若是「换行 + 纯空白」：移除该空白行文（其缩进由模板首行补齐），
  // 模板之后恢复原有收尾缩进，使既有 `</body>` 行保持原样。
  const before = source.slice(0, insertOffset);
  const tail = /\n[ \t]*$/.exec(before);
  let spliceEnd = insertOffset;
  let insertion: string;
  if (tail) {
    insertOffset -= tail[0].length - 1; // 移到换行之后，删去原空白行文
    spliceEnd = insertOffset + (tail[0].length - 1);
    insertion = `${template}\n${tail[0].slice(1)}`;
  } else {
    insertion = `\n${template}`;
  }
  return {
    source: source.slice(0, insertOffset) + insertion + source.slice(spliceEnd),
    index: info.slides.length,
  };
}

/** 删除一页（精确移除元素源码块）；删到 0 页合法（页面退化为普通页）。 */
export function deleteDeckSlide(source: string, index: number): string {
  const info = parseDeck(source);
  const slide = slideAt(info, index);
  return source.slice(0, slide.span.start) + source.slice(slide.span.end);
}

/**
 * 更新/写入幻灯片的 data-title / data-notes。值超长或含控制字符抛
 * INVALID_VALUE；写入时属性值按 " & < > 转义。既有属性整体替换其
 * attributeSpan，缺失时在 start tag 末尾插入。
 */
function updateSlideAttribute(
  source: string,
  index: number,
  name: typeof TITLE_ATTRIBUTE | typeof NOTES_ATTRIBUTE,
  value: string,
  maxLength: number,
  label: string
): string {
  const deck = parseDeckInternal(source);
  slideAt(deck.info, index);
  if (typeof value !== 'string') {
    throw new DesignEditError('INVALID_VALUE', `${label}必须是字符串`);
  }
  if (value.length > maxLength) {
    throw new DesignEditError('INVALID_VALUE', `${label}不能超过 ${maxLength} 字符`);
  }
  if (hasControlChars(value)) {
    throw new DesignEditError('INVALID_VALUE', `${label}包含控制字符`);
  }
  const element = deck.elements[index];
  if (!element) {
    throw new DesignEditError('MALFORMED_HTML', '幻灯片元素缺少源码位置');
  }
  const replacement = `${name}="${escapeAttrValue(value)}"`;
  const existing = attributeSpan(element, name);
  if (existing) {
    return source.slice(0, existing.start) + replacement + source.slice(existing.end);
  }
  const at = newAttributeInsertOffset(source, element);
  if (at === null) {
    throw new DesignEditError('MALFORMED_HTML', '幻灯片元素缺少源码位置');
  }
  return source.slice(0, at) + ` ${replacement}` + source.slice(at);
}

/** 更新/写入 data-title（≤200 字符，校验与转义见 updateSlideAttribute）。 */
export function updateDeckSlideTitle(source: string, index: number, title: string): string {
  return updateSlideAttribute(source, index, TITLE_ATTRIBUTE, title, MAX_TITLE_LENGTH, '标题');
}

/** 更新/写入 data-notes（≤2000 字符，校验与转义见 updateSlideAttribute）。 */
export function updateDeckSlideNotes(source: string, index: number, notes: string): string {
  return updateSlideAttribute(source, index, NOTES_ATTRIBUTE, notes, MAX_NOTES_LENGTH, '备注');
}

/** body 写/改 data-zclaudia-deck-ratio（无 body 抛 MALFORMED_HTML，值非法抛 INVALID_VALUE）。 */
export function setDeckRatio(source: string, ratio: DeckRatio): string {
  if (ratio !== '16:9' && ratio !== '4:3') {
    throw new DesignEditError('INVALID_VALUE', '比例仅支持 16:9 或 4:3');
  }
  const deck = parseDeckInternal(source);
  const body = deck.body;
  const replacement = `${RATIO_ATTRIBUTE}="${ratio}"`;
  const existing = attributeSpan(body, RATIO_ATTRIBUTE);
  if (existing) {
    return source.slice(0, existing.start) + replacement + source.slice(existing.end);
  }
  const at = newAttributeInsertOffset(source, body);
  if (at === null) {
    throw new DesignEditError('MALFORMED_HTML', 'body 元素缺少源码位置');
  }
  return source.slice(0, at) + ` ${replacement}` + source.slice(at);
}

const SLIDE_HIDE_RULE = '[data-zclaudia-slide]{display:none!important}';
const SLIDE_ACTIVE_RULE =
  '[data-zclaudia-slide][data-zclaudia-slide-active]{display:block!important}';

/**
 * 输入 = 已构建好的静态预览 HTML（含桥接 script）；输出 = 仅显示第 index
 * 页（0 基）、移除全部 `<script>`、注入 display 规则的渲染用 HTML。供
 * 缩略图/播放/捕获共用。index 越界抛 INVALID_VALUE。
 */
export function filterSlideInPreviewHtml(previewHtml: string, index: number): string {
  const doc = new DOMParser().parseFromString(previewHtml, 'text/html');
  doc.querySelectorAll('script').forEach(script => script.remove());
  const slides = Array.from(doc.querySelectorAll('[data-zclaudia-slide]'));
  if (!Number.isSafeInteger(index) || index < 0 || index >= slides.length) {
    throw new DesignEditError('INVALID_VALUE', '幻灯片序号越界');
  }
  const style = doc.createElement('style');
  style.textContent = `${SLIDE_HIDE_RULE}\n${SLIDE_ACTIVE_RULE}`;
  doc.head.appendChild(style);
  const active = slides[index];
  if (active) active.setAttribute('data-zclaudia-slide-active', '');
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}
