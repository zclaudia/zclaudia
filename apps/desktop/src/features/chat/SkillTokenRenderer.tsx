import type { CSSProperties, ReactNode } from 'react';
import { SquareSlash, Sparkles, X } from 'lucide-react';
import { FileSymbol } from '../../components/filesymbols';

/**
 * Token renderer for the composer's `rich-textarea` backdrop.
 *
 * `rich-textarea` keeps the underlying <textarea> text transparent and renders
 * the nodes returned here as the visible text, perfectly aligned with the
 * caret. Matched `/skill` / `/command` tokens render as an icon (Sparkles for
 * skills, SquareSlash for commands) painted over the hidden leading sigil;
 * `@file` tokens render a basename-keyed `FileSymbol` glyph instead. Either
 * way the token name follows in `--primary`. The icon is absolutely
 * positioned so it adds no layout width — the sigil still occupies its
 * normal (transparent) width, keeping the caret aligned with the raw text.
 *
 * Hovering a token (via `interaction`) swaps its icon to an X and tints the
 * token with `--secondary`; clicking the icon slot deletes the token. This
 * works because `rich-textarea` re-dispatches the real textarea's mouse
 * events to whichever backdrop node sits under the cursor and synthesizes
 * mouseover/mouseout — so plain React handlers on these spans fire at
 * runtime even though the textarea itself is what receives the events.
 * On devices without hover (see `isHoverCapable`) these handlers are not
 * attached at all: mobile browsers synthesize mouseover+click on tap, which
 * would silently delete a token when tapping near its sigil to place the
 * caret — with no visible X affordance. There, tapping only places the
 * caret and tokens are deleted via backspace.
 *
 * Token matching: a candidate token starts with `/` or `@` and runs to the
 * next whitespace. A `/` token is a **command** if it exactly matches a
 * string in `commandSet`; a **skill** if the id segment (before any `:`) is
 * in `skillIds`. An `@` token is a **file** reference if it matches
 * `FILE_TOKEN_RE` below — a conservative whole-token form of the chat area's
 * @file rule (chat also linkifies after '(' and ignores trailing
 * punctuation; the composer highlights a strict subset, see
 * `FileReference.tsx`).
 *
 * INVARIANT: the concatenated text of the returned nodes must equal `value`
 * exactly — rich-textarea relies on this for alignment. Do not add or drop
 * characters (no trailing newline).
 */

export type TokenKind = 'skill' | 'command' | 'file';

// Conservative whole-token form of the chat area's @file rule
// (FileReference.tsx): chat also linkifies after '(' and ignores trailing
// punctuation, but the composer only highlights this strict subset.
const FILE_TOKEN_RE = /^@[a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+$/;

export interface Segment {
  text: string;
  // 'plain' = ordinary foreground text; token kinds render icon + primary-colored name
  kind: 'plain' | TokenKind;
  /** Offset of `text` within the raw composer value. */
  start: number;
}

/**
 * Split `value` into segments. A candidate token is `/` or `@` + non-whitespace,
 * preceded by start-of-string or whitespace. Matched tokens become one
 * segment whose text INCLUDES the leading sigil; everything else stays plain.
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

/**
 * Non-reactive check for hover capability (kept local so tests that mock
 * shared hook modules are unaffected). Detects the *absence* of hover via
 * `(hover: none)` so environments where matchMedia is missing or mocked to
 * always-false (jsdom, SSR) default to hover-capable, preserving desktop
 * behavior. Exported for tests.
 */
export function isHoverCapable(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return !window.matchMedia('(hover: none)').matches;
}

/** Callbacks wired by MessageInput; all offsets are token `start` values. */
export interface TokenInteraction {
  hoveredTokenStart: number | null;
  onTokenHover: (tokenStart: number | null) => void;
  /** Hovering the sigil/icon slot specifically (drives the pointer cursor). */
  onDeleteZoneHover: (hovering: boolean) => void;
  onDeleteToken: (tokenStart: number) => void;
}

const TOKEN_ICON: Record<Exclude<TokenKind, 'file'>, typeof Sparkles> = {
  skill: Sparkles,
  command: SquareSlash,
};

// Paint-only icon: absolute (zero layout width), right-aligned to the end of
// the hidden sigil slot. 0.85em keeps the ink inside the preceding
// space+sigil advance so it never covers the previous word; the composer's
// 0.6em paddingLeft (MessageInput) gives line-start tokens room to paint
// (icon box overhangs the sigil slot by ~0.55em; 0.6em keeps it unclipped).
// File tokens paint a basename-keyed FileSymbol glyph instead of a lucide
// icon here; the wrapper span still uses this same geometry.
const ICON_STYLE: CSSProperties = {
  position: 'absolute',
  right: 0,
  top: '50%',
  transform: 'translateY(-50%)',
  width: '0.85em',
  height: '0.85em',
  color: 'hsl(var(--primary))',
};

// FileSymbol wrapper geometry. Two deltas vs ICON_STYLE: display:flex kills
// the wrapper's line box — without it the inline-flex FileSymbol child sits
// on the baseline of the composer's inherited 24px line-height and paints
// ~6px too low. And the glyph gets a 1em box because the Symbols artwork
// carries internal padding (visible ink is smaller than lucide's); the `@`
// advance is ~0.92em wide, so a right-aligned 1em box overhangs the slot by
// only ~0.08em and never covers the previous word.
const FILE_ICON_STYLE: CSSProperties = {
  ...ICON_STYLE,
  width: '1em',
  height: '1em',
  display: 'flex',
  // Optical correction: box-center alignment reads slightly high against
  // text (whose visual mass sits below the em-box center), so bias the
  // glyph down a hair.
  top: 'calc(50% + 0.075em)',
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
  // On touch devices (no hover) the X swap never shows, yet browsers
  // synthesize mouseover+click on tap — so a tap near the sigil to place the
  // caret would silently delete the token. Disable hover/click-delete there;
  // tapping just places the caret and deletion happens via backspace.
  const hoverInteraction = isHoverCapable() ? interaction : undefined;
  return splitSegments(value, commandSet, skillIds).map((seg, i) => {
    if (seg.kind === 'plain') {
      return (
        <span key={i} style={{ color: 'hsl(var(--foreground))' }}>
          {seg.text}
        </span>
      );
    }
    const hovered = hoverInteraction?.hoveredTokenStart === seg.start;
    const name = seg.text.slice(1);
    let icon: ReactNode;
    if (hovered) {
      icon = <X aria-hidden strokeWidth={1.75} style={ICON_STYLE} />;
    } else if (seg.kind === 'file') {
      const basename = name.split('/').pop() ?? name;
      icon = (
        <span data-token-file-icon style={FILE_ICON_STYLE}>
          <FileSymbol name={basename} className="h-full w-full" />
        </span>
      );
    } else {
      const Icon = TOKEN_ICON[seg.kind];
      icon = <Icon aria-hidden strokeWidth={1.75} style={ICON_STYLE} />;
    }
    return (
      <span
        key={i}
        data-token-start={seg.start}
        onMouseOver={hoverInteraction && (() => hoverInteraction.onTokenHover(seg.start))}
        onMouseOut={hoverInteraction && (() => hoverInteraction.onTokenHover(null))}
        style={
          hovered ? { backgroundColor: 'hsl(var(--secondary))', borderRadius: '4px' } : undefined
        }
      >
        <span
          data-token-delete
          onMouseOver={
            hoverInteraction &&
            (e => {
              e.stopPropagation();
              hoverInteraction.onTokenHover(seg.start);
              hoverInteraction.onDeleteZoneHover(true);
            })
          }
          onMouseOut={
            hoverInteraction &&
            (e => {
              e.stopPropagation();
              hoverInteraction.onTokenHover(null);
              hoverInteraction.onDeleteZoneHover(false);
            })
          }
          onClick={hoverInteraction && (() => hoverInteraction.onDeleteToken(seg.start))}
          style={{
            position: 'relative',
            color: 'transparent',
            WebkitTextFillColor: 'transparent',
          }}
        >
          {seg.text[0]}
          {icon}
        </span>
        <span style={{ color: 'hsl(var(--primary))' }}>{name}</span>
      </span>
    );
  });
}
