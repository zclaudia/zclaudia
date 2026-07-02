import { useMemo, type CSSProperties } from 'react';

/**
 * Overlay that renders the composer's visible text, highlighting
 * `/skill_name` and `/command` tokens — and HIDING their leading `/`.
 *
 * **Architecture:** the textarea keeps its text transparent (so its glyphs
 * don't double up with this overlay) but keeps caret/selection working via
 * `caret-color`. THIS overlay is the sole renderer of the visible text:
 *   - plain text segments → rendered in `--foreground` (fully visible)
 *   - a matched token's `/` → rendered transparent (hidden)
 *   - a matched token's name → rendered as a colored `<mark>` chip
 *
 * Because the overlay always renders all text as visible foreground, the
 * composer is never "blank" — even with no token matched, text shows normally.
 *
 * **Alignment requirement:** the overlay div must mirror the textarea's exact
 * box model (padding, font-size, line-height, white-space) via `className` /
 * `style`, or the marks won't line up with the textarea caret.
 *
 * Token matching: a candidate token starts with `/` and runs to the next
 * whitespace. It's a **command** if it exactly matches a string in
 * `commandSet`; a **skill** if the id segment (before any `:`) is in
 * `skillIds`. Commands render purple; skills render blue.
 */

export type TokenKind = 'skill' | 'command';

export interface SkillTokenHighlighterProps {
  value: string;
  /** Skill ids (without leading `/`) eligible for highlighting. */
  skillIds: Set<string>;
  /** Full command strings eligible for highlighting (e.g. `/clear`, `/a:b`). */
  commandSet: Set<string>;
  /** Box-model to mirror from the textarea (padding/sizing) for alignment. */
  className: string;
  /** Inline style to mirror (font-size, min/max-height). */
  style?: CSSProperties;
}

interface Segment {
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
function splitSegments(value: string, commandSet: Set<string>, skillIds: Set<string>): Segment[] {
  const segments: Segment[] = [];
  const re = /(?:^|\s)(\/[^\s]*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value)) !== null) {
    const leadingSpace = match[0].slice(0, match[0].length - match[1].length);
    const token = match[1];
    const tokenStart = match.index + leadingSpace.length;
    // text before this token (includes the leading whitespace)
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
      // Hide the leading `/`; color the rest of the token.
      segments.push({ text: '/', kind: 'hidden' });
      segments.push({ text: token.slice(1), kind });
    } else {
      // Unmatched `/something` — render as ordinary visible text.
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

export function SkillTokenHighlighter({
  value,
  skillIds,
  commandSet,
  className,
  style,
}: SkillTokenHighlighterProps) {
  const nodes = useMemo(
    () =>
      splitSegments(value, commandSet, skillIds).map((seg, i) => {
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
        // colored chip
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
      }),
    [value, commandSet, skillIds]
  );

  return (
    <div
      aria-hidden="true"
      className={className}
      // The overlay carries the visible text color; the textarea above is
      // transparent. pointer-events/selection disabled so interaction still
      // hits the textarea.
      style={{
        ...style,
        pointerEvents: 'none',
        userSelect: 'none',
        color: 'hsl(var(--foreground))',
      }}
    >
      {nodes}
      {'\n'}
    </div>
  );
}
