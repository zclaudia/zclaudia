/**
 * P7 §6.1 评论元素定位（S5 纯函数）。
 *
 * matchCommentTarget 用 parse5（与 element-tree.ts 同款 `{ sourceCodeLocationInfo: true }`
 * 用法，复用 html/parse 的解析 / body 查找 / 路径下钻）在指定源码中严格定位评论目标：
 *
 * - `target.elementPath` 语义与既有选区一致：从 body 起逐级取「元素子节点」序号。
 *   html/parse.ts 的 findElement 走 childElements（跳过文本/注释/doctype 节点），
 *   element-tree.ts 的树路径同源，故这里直接复用 findElement，不做全量 children 索引。
 * - 只做严格匹配：路径越界 / 标签不符 / 折叠文本不符即失效并给原因，绝不模糊或
 *   邻近重挂（P7.2 红线：不静默挂到其他元素）。
 * - target 为 null 表示整页评论，恒 matched（无定位失效概念）。
 * - parse5 隐式补全的节点（如未写的 tbody）无 sourceCodeLocation：文本已校验，
 *   仍算命中，只是没有源码切片（snippet undefined）。
 */

import type { DesignShareCommentTarget } from './api';
import type { P5Element } from './html/parse';
import { findElement, isTextNode, parseDocument } from './html/parse';

export interface CommentLocatorMatch {
  matched: boolean;
  reason?: 'path-missing' | 'tag-mismatch' | 'text-mismatch';
  /** 命中元素的折叠文本（≤200）。 */
  text?: string;
  /** 命中元素的源码切片（sourceCodeLocation 起止 offset，≤1200）。 */
  snippet?: string;
}

export type CommentLocatorMissReason = NonNullable<CommentLocatorMatch['reason']>;

/** 折叠文本上限（与选区文本口径一致）。 */
const TEXT_LIMIT = 200;
/** 源码切片上限。 */
const SNIPPET_LIMIT = 1200;

/** 失效原因 → 中文短语（review-handoff 失效文案复用）。 */
export const LOCATOR_REASON_TEXT: Record<CommentLocatorMissReason, string> = {
  'path-missing': 'Path out of range',
  'tag-mismatch': 'Tag changed',
  'text-mismatch': 'Text changed',
};

/** 折叠全部空白（\s+ → 单空格）并去首尾空白；比较与展示共用。 */
export function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** 超长截断到 max 字符并以 `…` 结尾（结果总长 ≤ max，与 agent-context 同款）。 */
export function truncateText(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** 元素子树内全部文本（textContent 语义：按源顺序拼接所有后代文本节点，不含注释）。 */
function elementText(element: P5Element): string {
  let text = '';
  for (const child of element.childNodes) {
    if (isTextNode(child)) text += child.value;
    else if (!child.nodeName.startsWith('#')) text += elementText(child as P5Element);
  }
  return text;
}

/**
 * 在 source 中严格定位 target。命中给 text + snippet；失效给 reason：
 * path-missing（body 缺失或 elementPath 中途越界/非元素）、tag-mismatch、text-mismatch。
 */
export function matchCommentTarget(
  source: string,
  target: DesignShareCommentTarget | null
): CommentLocatorMatch {
  // 整页评论：无元素定位，恒命中（无失效概念）。
  if (target === null) return { matched: true };

  const { document } = parseDocument(source);
  // findElement：body 起按元素子节点序号下钻（element-tree.ts 同语义）；
  // body 缺失 / 路径越界 / 序号非法一律视为路径失效。
  const element = findElement(document, target.elementPath);
  if (!element) return { matched: false, reason: 'path-missing' };

  // 标签严格小写比对（选区载荷本就是小写，这里对 target 兜底 toLowerCase）。
  if (element.nodeName.toLowerCase() !== target.tagName.toLowerCase()) {
    return { matched: false, reason: 'tag-mismatch' };
  }

  const text = truncateText(normalizeText(elementText(element)), TEXT_LIMIT);
  if (text !== normalizeText(target.text)) {
    return { matched: false, reason: 'text-mismatch' };
  }

  // 隐式节点（parse5 补全）无 sourceCodeLocation：文本已校验故仍命中，仅无切片。
  const loc = element.sourceCodeLocation;
  if (!loc) return { matched: true, text };
  const snippet = truncateText(source.slice(loc.startOffset, loc.endOffset), SNIPPET_LIMIT);
  return { matched: true, text, snippet };
}
