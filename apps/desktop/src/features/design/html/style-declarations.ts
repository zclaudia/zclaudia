interface Segment {
  /** [start, end) of the segment text within the style value; the top-level `;` sits at `end`. */
  start: number;
  end: number;
}

/**
 * Split a decoded inline style value into segments at top-level `;`.
 * Semicolons inside quotes, inside parentheses (e.g. url(...)) and inside
 * `/* ... *`/ comments do not split.
 */
function splitTopLevel(input: string): Segment[] {
  const segments: Segment[] = [];
  let start = 0;
  let quote: string | null = null;
  let parenDepth = 0;
  let inComment = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (inComment) {
      if (ch === '*' && input[i + 1] === '/') {
        inComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && input[i + 1] === '*') {
      inComment = true;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '(') {
      parenDepth += 1;
      continue;
    }
    if (ch === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (ch === ';' && parenDepth === 0) {
      segments.push({ start, end: i });
      start = i + 1;
    }
  }
  segments.push({ start, end: input.length });
  return segments;
}

/**
 * Set or remove a single declaration in a decoded inline style value.
 *
 * - Matches the LAST declaration with the same property name (inline cascade:
 *   the later one wins); earlier same-name declarations are preserved verbatim.
 * - Setting replaces the matched segment as `${originalName}: ${value}`
 *   (original property-name spelling kept); all other bytes are preserved.
 * - Removing deletes the matched segment plus one adjacent `;` (the one before
 *   it, or — for the first segment — the one after it).
 * - Appending joins with `; ` (or a single space when the value already ends
 *   with `;`); removing a declaration that does not exist returns the input
 *   unchanged.
 */
export function setDeclaration(styleValue: string, property: string, value: string | null): string {
  const segments = splitTopLevel(styleValue);
  const propertyLower = property.toLowerCase();

  let matchIndex = -1;
  let matchName = '';
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const segment = segments[i];
    if (!segment) continue;
    const text = styleValue.slice(segment.start, segment.end);
    const colon = text.indexOf(':');
    const name = (colon === -1 ? text : text.slice(0, colon)).trim();
    if (name.toLowerCase() === propertyLower) {
      matchIndex = i;
      matchName = name;
      break;
    }
  }

  const match = matchIndex >= 0 ? segments[matchIndex] : undefined;
  if (match) {
    if (value === null) {
      if (matchIndex > 0) {
        const previous = segments[matchIndex - 1];
        const start = previous ? previous.end : match.start; // offset of the preceding `;`
        return styleValue.slice(0, start) + styleValue.slice(match.end);
      }
      const ateDelimiter = match.end < styleValue.length ? 1 : 0;
      return styleValue.slice(0, match.start) + styleValue.slice(match.end + ateDelimiter);
    }
    return `${styleValue.slice(0, match.start)}${matchName}: ${value}${styleValue.slice(match.end)}`;
  }

  if (value === null) return styleValue;
  const trimmed = styleValue.trim();
  if (!trimmed) return `${property}: ${value}`;
  if (trimmed.endsWith(';')) return `${trimmed} ${property}: ${value}`;
  return `${trimmed}; ${property}: ${value}`;
}

export interface StyleDeclaration {
  name: string;
  value: string;
}

/**
 * 解析 inline 声明列表（设计文档 §3.1）。
 *
 * - 复用顶层分号切分（引号/括号/注释内的 `;` 不切分）；
 * - 无冒号的段落跳过；name/value 各自 trim；
 * - 保留原文拼写；同名属性（大小写不敏感）只保留最后一条，
 *   位置按首次出现的顺序。
 */
export function parseDeclarations(styleValue: string): StyleDeclaration[] {
  const byName = new Map<string, StyleDeclaration>();
  for (const segment of splitTopLevel(styleValue)) {
    const text = styleValue.slice(segment.start, segment.end);
    const colon = text.indexOf(':');
    if (colon === -1) continue;
    const name = text.slice(0, colon).trim();
    const value = text.slice(colon + 1).trim();
    byName.set(name.toLowerCase(), { name, value });
  }
  return [...byName.values()];
}
