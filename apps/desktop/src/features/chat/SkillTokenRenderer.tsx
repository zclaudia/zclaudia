import type { CSSProperties, ReactNode } from 'react';

/**
 * Token renderer for the composer's `rich-textarea` backdrop.
 *
 * `rich-textarea` keeps the underlying <textarea> text transparent and renders
 * the nodes returned here as the visible text, perfectly aligned with the
 * caret. We color `/skill` / `/command` tokens and HIDE their leading `/` by
 * rendering it as a transparent (but width-occupying) span so the caret stays
 * aligned with the raw value.
 *
 * Token matching: a candidate token starts with `/` and runs to the next
 * whitespace. It's a **command** if it exactly matches a string in
 * `commandSet`; a **skill** if the id segment (before any `:`) is in
 * `skillIds`. Commands render purple; skills render blue.
 *
 * INVARIANT: the concatenated text of the returned nodes must equal `value`
 * exactly — rich-textarea relies on this for alignment. Do not add or drop
 * characters (no trailing newline).
 */

export type TokenKind = 'skill' | 'command';

export interface Segment {
  text: string;
  // 'plain' = visible foreground text
  // 'hidden' = transparent (used for the `/` of a matched token)
  // 'skill' | 'command' = colored chip
  kind: 'plain' | 'hidden' | TokenKind;
}

/**
 * Split `value` into segments. A token is `/` + non-whitespace. Matched
 * tokens become [hidden `/`][colored name]; unmatched text stays plain.
 */
export function splitSegments(
  value: string,
  commandSet: Set<string>,
  skillIds: Set<string>
): Segment[] {
  const segments: Segment[] = [];
  const re = /(?:^|\s)(\/[^\s]*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value)) !== null) {
    const leadingSpace = match[0].slice(0, match[0].length - match[1].length);
    const token = match[1];
    const tokenStart = match.index + leadingSpace.length;
    if (tokenStart > last) {
      segments.push({ text: value.slice(last, tokenStart), kind: 'plain' });
    }
    let kind: TokenKind | null = null;
    if (commandSet.has(token)) {
      kind = 'command';
    } else {
      const idPart = token.slice(1).split(':')[0];
      if (idPart && skillIds.has(idPart)) kind = 'skill';
    }
    if (kind) {
      segments.push({ text: '/', kind: 'hidden' });
      segments.push({ text: token.slice(1), kind });
    } else {
      segments.push({ text: token, kind: 'plain' });
    }
    last = tokenStart + token.length;
  }
  if (last < value.length) {
    segments.push({ text: value.slice(last), kind: 'plain' });
  }
  return segments;
}

const CHIP_STYLE_BY_KIND: Record<TokenKind, CSSProperties> = {
  skill: {
    backgroundColor: 'hsl(var(--primary) / 0.18)',
    boxShadow: 'inset 0 0 0 1px hsl(var(--primary) / 0.35)',
    color: 'hsl(var(--primary))',
    borderRadius: '4px',
  },
  command: {
    backgroundColor: 'hsl(var(--thinking) / 0.18)',
    boxShadow: 'inset 0 0 0 1px hsl(var(--thinking) / 0.35)',
    color: 'hsl(var(--thinking))',
    borderRadius: '4px',
  },
};

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
      return <span key={i}>{seg.text}</span>;
    }
    if (seg.kind === 'hidden') {
      return (
        <span key={i} style={{ color: 'transparent', WebkitTextFillColor: 'transparent' }}>
          {seg.text}
        </span>
      );
    }
    return (
      <mark
        key={i}
        style={{
          ...CHIP_STYLE_BY_KIND[seg.kind],
          padding: '0.5px 2px',
          margin: '0 -2px',
          WebkitBackgroundClip: 'padding-box',
          backgroundClip: 'padding-box',
        }}
      >
        {seg.text}
      </mark>
    );
  });
}
