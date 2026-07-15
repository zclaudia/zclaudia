import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { splitSegments, renderSkillTokens, deleteTokenAt } from './SkillTokenRenderer';

const skills = new Set(['commit', 'brainstorming']);
const commands = new Set(['/clear', '/commit-commands:commit']);

describe('splitSegments', () => {
  it('returns a single plain segment for text with no tokens', () => {
    expect(splitSegments('hello world', commands, skills)).toEqual([
      { text: 'hello world', kind: 'plain', start: 0 },
    ]);
  });

  it('splits a known skill into one token segment with its offset', () => {
    expect(splitSegments('/commit now', commands, skills)).toEqual([
      { text: '/commit', kind: 'skill', start: 0 },
      { text: ' now', kind: 'plain', start: 7 },
    ]);
  });

  it('treats an exact command match as a command token', () => {
    expect(splitSegments('/clear', commands, skills)).toEqual([
      { text: '/clear', kind: 'command', start: 0 },
    ]);
  });

  it('matches a plugin command by full string', () => {
    expect(splitSegments('/commit-commands:commit', commands, skills)).toEqual([
      { text: '/commit-commands:commit', kind: 'command', start: 0 },
    ]);
  });

  it('matches a skill by the id segment before a colon', () => {
    expect(splitSegments('/commit:foo', commands, skills)).toEqual([
      { text: '/commit:foo', kind: 'skill', start: 0 },
    ]);
  });

  it('records the offset of a mid-text token', () => {
    expect(splitSegments('run /commit now', commands, skills)).toEqual([
      { text: 'run ', kind: 'plain', start: 0 },
      { text: '/commit', kind: 'skill', start: 4 },
      { text: ' now', kind: 'plain', start: 11 },
    ]);
  });

  it('leaves an unknown /path as plain text', () => {
    expect(splitSegments('/usr/local/bin', commands, skills)).toEqual([
      { text: '/usr/local/bin', kind: 'plain', start: 0 },
    ]);
  });

  it('merges an unmatched token into the plain gap before a matched one', () => {
    expect(splitSegments('/unknown /clear', commands, skills)).toEqual([
      { text: '/unknown ', kind: 'plain', start: 0 },
      { text: '/clear', kind: 'command', start: 9 },
    ]);
  });

  it('keeps the separator between two matched tokens as a plain segment', () => {
    expect(splitSegments('/clear /commit', commands, skills)).toEqual([
      { text: '/clear', kind: 'command', start: 0 },
      { text: ' ', kind: 'plain', start: 6 },
      { text: '/commit', kind: 'skill', start: 7 },
    ]);
  });

  it('matches a token preceded by a newline', () => {
    expect(splitSegments('a\n/clear', commands, skills)).toEqual([
      { text: 'a\n', kind: 'plain', start: 0 },
      { text: '/clear', kind: 'command', start: 2 },
    ]);
  });

  it('reconstructs the input and keeps offsets consistent', () => {
    const inputs = ['/unknown /clear x', 'run /commit /clear', '/usr/bin /commit:x end'];
    for (const value of inputs) {
      const segments = splitSegments(value, commands, skills);
      expect(segments.map((s) => s.text).join('')).toBe(value);
      let offset = 0;
      for (const seg of segments) {
        expect(seg.start).toBe(offset);
        offset += seg.text.length;
      }
    }
  });
});

describe('renderSkillTokens', () => {
  it('renders icon + colored name and keeps the full text', () => {
    const { container } = render(
      <div>{renderSkillTokens('/commit go', skills, commands)}</div>
    );
    // full textContent still equals the raw value (slash transparent but present)
    expect(container.textContent).toBe('/commit go');
    // skill icon present, no filled-pill <mark> anymore
    expect(container.querySelector('svg.lucide-sparkles')).not.toBeNull();
    expect(container.querySelector('mark')).toBeNull();
  });

  it('uses the command icon for commands', () => {
    const { container } = render(
      <div>{renderSkillTokens('/clear', skills, commands)}</div>
    );
    expect(container.querySelector('svg.lucide-square-slash')).not.toBeNull();
  });

  it('renders plain text with no icon when nothing matches', () => {
    const { container } = render(
      <div>{renderSkillTokens('just text', skills, commands)}</div>
    );
    expect(container.querySelector('svg')).toBeNull();
    expect(container.textContent).toBe('just text');
  });

  it('swaps to the X icon when the token is hovered', () => {
    const interaction = {
      hoveredTokenStart: 4,
      onTokenHover: vi.fn(),
      onDeleteZoneHover: vi.fn(),
      onDeleteToken: vi.fn(),
    };
    const { container } = render(
      <div>{renderSkillTokens('run /commit go', skills, commands, interaction)}</div>
    );
    expect(container.querySelector('svg.lucide-x')).not.toBeNull();
    expect(container.querySelector('svg.lucide-sparkles')).toBeNull();
  });

  it('reports hover and delete interactions with the token offset', () => {
    const interaction = {
      hoveredTokenStart: null,
      onTokenHover: vi.fn(),
      onDeleteZoneHover: vi.fn(),
      onDeleteToken: vi.fn(),
    };
    const { container } = render(
      <div>{renderSkillTokens('run /commit go', skills, commands, interaction)}</div>
    );
    const token = container.querySelector('[data-token-start="4"]')!;
    fireEvent.mouseOver(token);
    expect(interaction.onTokenHover).toHaveBeenCalledWith(4);
    fireEvent.mouseOut(token);
    expect(interaction.onTokenHover).toHaveBeenCalledWith(null);

    const slashSlot = token.querySelector('[data-token-delete]')!;
    fireEvent.mouseOver(slashSlot);
    expect(interaction.onDeleteZoneHover).toHaveBeenCalledWith(true);
    fireEvent.click(slashSlot);
    expect(interaction.onDeleteToken).toHaveBeenCalledWith(4);
  });
});

describe('deleteTokenAt', () => {
  it('deletes a leading token and one trailing space', () => {
    expect(deleteTokenAt('/commit now', 0, commands, skills)).toEqual({
      next: 'now',
      caret: 0,
    });
  });

  it('deletes a mid-text token', () => {
    expect(deleteTokenAt('run /commit now', 4, commands, skills)).toEqual({
      next: 'run now',
      caret: 4,
    });
  });

  it('deletes a token at the end without a trailing space', () => {
    expect(deleteTokenAt('run /commit', 4, commands, skills)).toEqual({
      next: 'run ',
      caret: 4,
    });
  });

  it('returns null when no token starts at the offset', () => {
    expect(deleteTokenAt('run /commit now', 5, commands, skills)).toBeNull();
    expect(deleteTokenAt('plain text', 0, commands, skills)).toBeNull();
  });

  it('does not absorb a trailing newline or tab', () => {
    expect(deleteTokenAt('/commit\nnow', 0, commands, skills)).toEqual({
      next: '\nnow',
      caret: 0,
    });
  });

  it('deletes the second of two tokens', () => {
    expect(deleteTokenAt('/clear /commit', 7, commands, skills)).toEqual({
      next: '/clear ',
      caret: 7,
    });
  });
});
