import type { ReactNode } from 'react';

/**
 * Token renderer for the composer's `rich-textarea` backdrop.
 *
 * `rich-textarea` keeps the underlying <textarea> text transparent and renders
 * the nodes returned here as the visible text, perfectly aligned with the
 * caret. Matched `/skill` / `/command` tokens currently render as plain
 * primary-colored spans; icon + hover-delete rendering lands in a follow-up
 * task.
 *
 * Token matching: a candidate token starts with `/` and runs to the next
 * whitespace. It's a **command** if it exactly matches a string in
 * `commandSet`; a **skill** if the id segment (before any `:`) is in
 * `skillIds`.
 *
 * INVARIANT: the concatenated text of the returned nodes must equal `value`
 * exactly — rich-textarea relies on this for alignment. Do not add or drop
 * characters (no trailing newline).
 */

export type TokenKind = 'skill' | 'command';

export interface Segment {
  text: string;
  // 'plain' = ordinary foreground text; token kinds render as primary-colored
  // spans (icon + hover-delete rendering lands in a follow-up task)
  kind: 'plain' | TokenKind;
  /** Offset of `text` within the raw composer value. */
  start: number;
}

/**
 * Split `value` into segments. A candidate token is `/` + non-whitespace,
 * preceded by start-of-string or whitespace. Matched tokens become one
 * segment whose text INCLUDES the leading slash; everything else stays plain.
 */
export function splitSegments(
  value: string,
  commandSet: Set<string>,
  skillIds: Set<string>
): Segment[] {
  const segments: Segment[] = [];
  const re = /(?:^|\s)(\/\S*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value)) !== null) {
    const token = match[1];
    const tokenStart = match.index + (match[0].length - token.length);
    let kind: TokenKind | null = null;
    if (commandSet.has(token)) {
      kind = 'command';
    } else {
      const idPart = token.slice(1).split(':')[0];
      if (idPart && skillIds.has(idPart)) kind = 'skill';
    }
    if (!kind) continue;
    if (tokenStart > last) {
      segments.push({ text: value.slice(last, tokenStart), kind: 'plain', start: last });
    }
    segments.push({ text: token, kind, start: tokenStart });
    last = tokenStart + token.length;
  }
  if (last < value.length) {
    segments.push({ text: value.slice(last), kind: 'plain', start: last });
  }
  return segments;
}

/**
 * Remove the matched token that starts at `tokenStart` from `value`, plus one
 * trailing space if present. Returns the next value and the caret offset to
 * restore, or null if no matched token starts there.
 */
export function deleteTokenAt(
  value: string,
  tokenStart: number,
  commandSet: Set<string>,
  skillIds: Set<string>
): { next: string; caret: number } | null {
  const seg = splitSegments(value, commandSet, skillIds).find(
    s => s.kind !== 'plain' && s.start === tokenStart
  );
  if (!seg) return null;
  let end = tokenStart + seg.text.length;
  if (value[end] === ' ') end += 1;
  return { next: value.slice(0, tokenStart) + value.slice(end), caret: tokenStart };
}

/**
 * rich-textarea render-prop. Returns the visible, colored nodes for `value`.
 */
export function renderSkillTokens(
  value: string,
  skillIds: Set<string>,
  commandSet: Set<string>
): ReactNode {
  return splitSegments(value, commandSet, skillIds).map((seg, i) => {
    if (seg.kind === 'plain') {
      return (
        <span key={i} style={{ color: 'hsl(var(--foreground))' }}>
          {seg.text}
        </span>
      );
    }
    return (
      <span key={i} style={{ color: 'hsl(var(--primary))' }}>
        {seg.text}
      </span>
    );
  });
}
