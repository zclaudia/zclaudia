import type { CSSProperties, ReactNode } from 'react';
import { Sparkles, SquareSlash, X } from 'lucide-react';

/**
 * Token renderer for the composer's `rich-textarea` backdrop.
 *
 * `rich-textarea` keeps the underlying <textarea> text transparent and renders
 * the nodes returned here as the visible text, perfectly aligned with the
 * caret. Matched `/skill` / `/command` tokens render as an icon (Sparkles for
 * skills, SquareSlash for commands) painted over the hidden leading slash,
 * followed by the token name in `--primary`. The icon is absolutely
 * positioned so it adds no layout width — the slash still occupies its
 * normal (transparent) width, keeping the caret aligned with the raw text.
 *
 * Hovering a token (via `interaction`) swaps its icon to an X and tints the
 * token with `--secondary`; clicking the icon slot deletes the token. This
 * works because `rich-textarea` re-dispatches the real textarea's mouse
 * events to whichever backdrop node sits under the cursor and synthesizes
 * mouseover/mouseout — so plain React handlers on these spans fire at
 * runtime even though the textarea itself is what receives the events.
 *
 * Token matching: a candidate token starts with `/` or `@` and runs to the
 * next whitespace. A `/` token is a **command** if it exactly matches a
 * string in `commandSet`; a **skill** if the id segment (before any `:`) is
 * in `skillIds`. An `@` token is a **file** reference if it matches the
 * chat area's linkify rule (see `FILE_TOKEN_RE` below / `FileReference.tsx`)
 * — composer highlighting mirrors exactly what the chat side will linkify
 * after send.
 *
 * INVARIANT: the concatenated text of the returned nodes must equal `value`
 * exactly — rich-textarea relies on this for alignment. Do not add or drop
 * characters (no trailing newline).
 */

export type TokenKind = 'skill' | 'command' | 'file';

// Whole-token form of the chat area's @file rule (FileReference.tsx): the
// composer highlights exactly what the chat side will linkify after send.
const FILE_TOKEN_RE = /^@[a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+$/;

export interface Segment {
  text: string;
  // 'plain' = ordinary foreground text; token kinds render icon + primary-colored name
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
  const re = /(?:^|\s)([/@]\S*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value)) !== null) {
    const token = match[1];
    const tokenStart = match.index + (match[0].length - token.length);
    let kind: TokenKind | null = null;
    if (token[0] === '/') {
      if (commandSet.has(token)) {
        kind = 'command';
      } else {
        const idPart = token.slice(1).split(':')[0];
        if (idPart && skillIds.has(idPart)) kind = 'skill';
      }
    } else if (FILE_TOKEN_RE.test(token)) {
      kind = 'file';
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

/** Callbacks wired by MessageInput; all offsets are token `start` values. */
export interface TokenInteraction {
  hoveredTokenStart: number | null;
  onTokenHover: (tokenStart: number | null) => void;
  /** Hovering the slash/icon slot specifically (drives the pointer cursor). */
  onDeleteZoneHover: (hovering: boolean) => void;
  onDeleteToken: (tokenStart: number) => void;
}

const TOKEN_ICON: Record<Exclude<TokenKind, 'file'>, typeof Sparkles> = {
  skill: Sparkles,
  command: SquareSlash,
};

// Paint-only icon: absolute (zero layout width), right-aligned to the end of
// the hidden slash slot. 0.85em keeps the ink inside the preceding
// space+slash advance so it never covers the previous word; the composer's
// 0.6em paddingLeft (MessageInput) gives line-start tokens room to paint
// (icon box overhangs the slash slot by ~0.55em; 0.6em keeps it unclipped).
const ICON_STYLE: CSSProperties = {
  position: 'absolute',
  right: 0,
  top: '50%',
  transform: 'translateY(-50%)',
  width: '0.85em',
  height: '0.85em',
  color: 'hsl(var(--primary))',
};

/**
 * rich-textarea render-prop. Returns the visible nodes for `value`.
 * INVARIANT: concatenated text of the returned nodes equals `value` exactly.
 */
export function renderSkillTokens(
  value: string,
  skillIds: Set<string>,
  commandSet: Set<string>,
  interaction?: TokenInteraction
): ReactNode {
  return splitSegments(value, commandSet, skillIds).map((seg, i) => {
    if (seg.kind === 'plain') {
      return (
        <span key={i} style={{ color: 'hsl(var(--foreground))' }}>
          {seg.text}
        </span>
      );
    }
    const hovered = interaction?.hoveredTokenStart === seg.start;
    // interim: FileSymbol glyph lands in the next commit
    const Icon = hovered ? X : seg.kind === 'file' ? Sparkles : TOKEN_ICON[seg.kind];
    return (
      <span
        key={i}
        data-token-start={seg.start}
        onMouseOver={() => interaction?.onTokenHover(seg.start)}
        onMouseOut={() => interaction?.onTokenHover(null)}
        style={
          hovered
            ? { backgroundColor: 'hsl(var(--secondary))', borderRadius: '4px' }
            : undefined
        }
      >
        <span
          data-token-delete
          onMouseOver={e => {
            e.stopPropagation();
            interaction?.onTokenHover(seg.start);
            interaction?.onDeleteZoneHover(true);
          }}
          onMouseOut={e => {
            e.stopPropagation();
            interaction?.onTokenHover(null);
            interaction?.onDeleteZoneHover(false);
          }}
          onClick={() => interaction?.onDeleteToken(seg.start)}
          style={{
            position: 'relative',
            color: 'transparent',
            WebkitTextFillColor: 'transparent',
          }}
        >
          {seg.text[0]}
          <Icon aria-hidden strokeWidth={1.75} style={ICON_STYLE} />
        </span>
        <span style={{ color: 'hsl(var(--primary))' }}>{seg.text.slice(1)}</span>
      </span>
    );
  });
}
