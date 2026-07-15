import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { splitSegments, renderSkillTokens } from './SkillTokenRenderer';

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
});

describe('renderSkillTokens', () => {
  it('renders a colored token and keeps the full text', () => {
    const { container } = render(
      <div>{renderSkillTokens('/commit go', skills, commands)}</div>
    );
    expect(container.textContent).toBe('/commit go');
  });

  it('renders plain text when nothing matches', () => {
    const { container } = render(
      <div>{renderSkillTokens('just text', skills, commands)}</div>
    );
    expect(container.textContent).toBe('just text');
  });
});
