export interface ContentMatch {
  line: number; // 1-based
  start: number; // column index in line, 0-based
  end: number; // exclusive end column
}

const SPECIAL_RE = /[.*+?^${}()|[\]\\]/g;

function escapeRegExp(text: string): string {
  return text.replace(SPECIAL_RE, '\\$&');
}

/**
 * Find all occurrences of `query` inside `content`.
 * Lines are 1-based; columns are 0-based byte indices (matches the
 * natural rendering of a code view).
 */
export function findContentMatches(
  content: string,
  query: string,
  caseSensitive = false
): ContentMatch[] {
  if (!query) return [];
  const lines = content.split(/\r?\n/);
  const flags = caseSensitive ? 'g' : 'gi';
  const re = new RegExp(escapeRegExp(query), flags);
  const matches: ContentMatch[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Reset lastIndex for each line so global search doesn't carry over state.
    re.lastIndex = 0;
    while (true) {
      const match = re.exec(line);
      if (match === null) break;
      matches.push({ line: i + 1, start: match.index, end: match.index + match[0].length });
      // Avoid infinite loop on zero-length matches (not expected from non-empty query,
      // but guard against pathological regex behavior).
      if (match[0].length === 0) break;
    }
  }

  return matches;
}

/**
 * Group matches by 1-based line number. Useful for rendering line highlights.
 */
export function matchesByLine(
  matches: ContentMatch[]
): Map<number, { start: number; end: number }[]> {
  const map = new Map<number, { start: number; end: number }[]>();
  for (const m of matches) {
    const arr = map.get(m.line) ?? [];
    arr.push({ start: m.start, end: m.end });
    map.set(m.line, arr);
  }
  return map;
}
