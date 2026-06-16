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

export interface WhitespaceMatch {
  /** Offset in the ORIGINAL fileContent where the matched span begins. */
  start: number;
  /** Exclusive end offset in the original fileContent. */
  end: number;
  /** The exact bytes in the file to replace (fileContent.slice(start, end)). */
  actualOldString: string;
  /** `replacement`, re-indented to the matched span's indentation. */
  adjustedNewString: string;
}

export type WhitespaceMatchResult =
  | { ok: true; match: WhitespaceMatch }
  | { ok: false; reason: 'not_found' | 'ambiguous'; count?: number };

function leadingWhitespace(line: string): string {
  const m = line.match(/^[ \t]*/);
  return m ? m[0] : '';
}

/**
 * Whitespace-safe fallback matcher. Runs only after exact + quote matching fail.
 * Tolerates line-ending and trailing-whitespace differences (Pass 1) and a
 * uniform indentation shift, re-indenting `replacement` to match (Pass 2). All
 * comparison is pure string-prefix work — no tab-width arithmetic — so mixed
 * indentation falls through to `not_found`, never a mis-indented edit. Returns a
 * match only when exactly one location matches; otherwise `ambiguous`/`not_found`.
 */
export function findWhitespaceMatch(
  fileContent: string,
  search: string,
  replacement: string,
): WhitespaceMatchResult {
  const nf = fileContent.replace(/\r\n/g, '\n');
  const fileLines = nf.split('\n');
  const searchLines = search.replace(/\r\n/g, '\n').split('\n');
  const L = searchLines.length;
  if (L === 0) return { ok: false, reason: 'not_found' };

  // Map each normalized file-line index to its start offset in the ORIGINAL
  // content. Only \r\n was collapsed, so the \r belongs to the separator, not the
  // line text — advance past the real separator after each line.
  const lineStartOffsets: number[] = new Array(fileLines.length);
  {
    let off = 0;
    for (let k = 0; k < fileLines.length; k++) {
      lineStartOffsets[k] = off;
      off += fileLines[k].length;
      if (fileContent[off] === '\r' && fileContent[off + 1] === '\n') off += 2;
      else if (fileContent[off] === '\n') off += 1;
    }
  }

  const trimEnd = (s: string): string => s.replace(/\s+$/, '');
  const firstNonBlank = searchLines.find(l => l.trim() !== '');
  const si = firstNonBlank !== undefined ? leadingWhitespace(firstNonBlank) : '';
  const pass2Eligible =
    firstNonBlank !== undefined && searchLines.every(l => l.trim() === '' || l.startsWith(si));

  const matches: WhitespaceMatch[] = [];
  for (let i = 0; i + L <= fileLines.length; i++) {
    let adjusted: string | null = null;

    // Pass 1: trailing-ws tolerant; leading indentation must match exactly.
    let pass1 = true;
    for (let j = 0; j < L; j++) {
      if (trimEnd(fileLines[i + j]) !== trimEnd(searchLines[j])) { pass1 = false; break; }
    }
    if (pass1) {
      adjusted = replacement;
    } else if (pass2Eligible) {
      // Pass 2: uniform indentation shift si -> fi.
      // Reject when si and fi use different whitespace kinds (tabs vs spaces).
      const fi = leadingWhitespace(fileLines[i]);
      const siKind = si.includes('\t') ? 'tab' : 'space';
      const fiKind = fi.includes('\t') ? 'tab' : 'space';
      if (si.length > 0 && fi.length > 0 && siKind !== fiKind) continue;
      let pass2 = true;
      for (let j = 0; j < L; j++) {
        const sl = searchLines[j];
        if (sl.trim() === '') {
          if (fileLines[i + j].trim() !== '') { pass2 = false; break; }
          continue;
        }
        if (trimEnd(fileLines[i + j]) !== trimEnd(fi + sl.slice(si.length))) { pass2 = false; break; }
      }
      if (pass2) {
        adjusted = replacement
          .split('\n')
          .map(line => (line.trim() === '' ? line : line.startsWith(si) ? fi + line.slice(si.length) : line))
          .join('\n');
      }
    }

    if (adjusted !== null) {
      const start = lineStartOffsets[i];
      const lastIdx = i + L - 1;
      // Use trimmed length for the last line so the matched span excludes
      // trailing whitespace (which is what triggered the Pass-1 tolerance).
      const lastLineLen = trimEnd(fileLines[lastIdx]).length;
      const end = lineStartOffsets[lastIdx] + lastLineLen;
      matches.push({ start, end, actualOldString: fileContent.slice(start, end), adjustedNewString: adjusted });
    }
  }

  if (matches.length === 0) return { ok: false, reason: 'not_found' };
  if (matches.length > 1) return { ok: false, reason: 'ambiguous', count: matches.length };
  return { ok: true, match: matches[0] };
}
