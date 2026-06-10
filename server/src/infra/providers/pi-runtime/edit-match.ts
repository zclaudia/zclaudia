const CURLY_MAP: Record<string, string> = {
  '‘': "'", // left single  (U+2018)
  '’': "'", // right single (U+2019)
  '“': '"', // left double  (U+201C)
  '”': '"', // right double (U+201D)
};

/** Map curly/smart quotes to their straight ASCII equivalents. */
export function normalizeQuotes(str: string): string {
  return str.replace(/[‘’“”]/g, (ch) => CURLY_MAP[ch] ?? ch);
}

/**
 * Locate `search` inside `fileContent`. Tries an exact match first; if that
 * fails, retries with curly/straight quotes normalized on both sides and
 * returns the ACTUAL substring from the file (preserving its real quotes).
 * Returns null when not found.
 */
export function findActualString(fileContent: string, search: string): string | null {
  if (fileContent.includes(search)) return search;
  const normalizedFile = normalizeQuotes(fileContent);
  const normalizedSearch = normalizeQuotes(search);
  const idx = normalizedFile.indexOf(normalizedSearch);
  if (idx !== -1) return fileContent.substring(idx, idx + search.length);
  return null;
}

/** Count non-overlapping occurrences of `needle` in `haystack`. */
export function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let pos = 0;
  for (;;) {
    const i = haystack.indexOf(needle, pos);
    if (i === -1) break;
    count++;
    pos = i + needle.length;
  }
  return count;
}

/**
 * Replace `oldStr` with `newStr` in `content`. Replacement is literal — `$`
 * sequences are NOT treated as regex backreferences. When `replaceAll` is
 * false, only the first occurrence is replaced.
 */
export function applyEdit(content: string, oldStr: string, newStr: string, replaceAll: boolean): string {
  if (replaceAll) return content.split(oldStr).join(newStr);
  const i = content.indexOf(oldStr);
  if (i === -1) return content;
  return content.slice(0, i) + newStr + content.slice(i + oldStr.length);
}
