import type { DefaultTreeAdapterMap } from 'parse5';
import { findElement, isTextNode, parseDocument } from '../html/parse';
import type { P5Element } from '../html/parse';

/**
 * 计算选区元素在草稿源码中的 1-based 行区间；定位失败返回 null（绝不猜测）。
 *
 * 找不到元素、tagName 不符（大小写不敏感）、无 sourceCodeLocation、或提供了
 * sourceText 而元素文本内容（trim 后）不等时均返回 null。行号基于草稿计算。
 */
export function elementLineRange(
  source: string,
  elementPath: number[],
  tagName: string,
  sourceText?: string
): { startLine: number; endLine: number } | null {
  const parsed = parseDocument(source);
  const element = findElement(parsed.document, elementPath);
  if (!element) return null;
  if (element.tagName.toLowerCase() !== tagName.toLowerCase()) return null;
  const location = element.sourceCodeLocation;
  if (!location) return null;
  if (sourceText !== undefined && textContentOf(element).trim() !== sourceText.trim()) return null;
  // startLine 为源码 [0, startOffset) 内换行数 +1；endLine 为 startLine 加区间内换行数。
  const startLine = countNewlines(source, 0, location.startOffset) + 1;
  const endLine = startLine + countNewlines(source, location.startOffset, location.endOffset);
  return { startLine, endLine };
}

/** Decoded text content of an element (all descendant text nodes, like textContent). */
function textContentOf(element: P5Element): string {
  let text = '';
  const visit = (node: DefaultTreeAdapterMap['childNode']): void => {
    if (isTextNode(node)) {
      text += node.value;
      return;
    }
    if (!node.nodeName.startsWith('#')) {
      for (const child of (node as P5Element).childNodes) visit(child);
    }
  };
  for (const child of element.childNodes) visit(child);
  return text;
}

function countNewlines(source: string, start: number, end: number): number {
  let count = 0;
  for (let index = start; index < end; index += 1) {
    if (source[index] === '\n') count += 1;
  }
  return count;
}
