import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { splitSegments, renderSkillTokens } from './SkillTokenRenderer';

const skills = new Set(['commit', 'brainstorming']);
const commands = new Set(['/clear', '/commit-commands:commit']);

describe('splitSegments', () => {
  it('returns a single plain segment for text with no tokens', () => {
    expect(splitSegments('hello world', commands, skills)).toEqual([
      { text: 'hello world', kind: 'plain' },
    ]);
  });

  it('splits a known skill into a hidden slash + a skill chip', () => {
    expect(splitSegments('/commit now', commands, skills)).toEqual([
      { text: '/', kind: 'hidden' },
      { text: 'commit', kind: 'skill' },
      { text: ' now', kind: 'plain' },
    ]);
  });

  it('treats an exact command match as a command chip', () => {
    expect(splitSegments('/clear', commands, skills)).toEqual([
      { text: '/', kind: 'hidden' },
      { text: 'clear', kind: 'command' },
    ]);
  });

  it('matches a plugin command by full string', () => {
    expect(splitSegments('/commit-commands:commit', commands, skills)).toEqual([
      { text: '/', kind: 'hidden' },
      { text: 'commit-commands:commit', kind: 'command' },
    ]);
  });

  it('matches a skill by the id segment before a colon', () => {
    // 'commit' is a known skill; '/commit:foo' id-part is 'commit'
    expect(splitSegments('/commit:foo', commands, skills)).toEqual([
      { text: '/', kind: 'hidden' },
      { text: 'commit:foo', kind: 'skill' },
    ]);
  });

  it('leaves an unknown /path as plain text', () => {
    expect(splitSegments('/usr/local/bin', commands, skills)).toEqual([
      { text: '/usr/local/bin', kind: 'plain' },
    ]);
  });
});

describe('renderSkillTokens', () => {
  it('renders a colored chip for a known skill and keeps the full text', () => {
    const { container } = render(
      <div>{renderSkillTokens('/commit go', skills, commands)}</div>
    );
    // the visible chip shows the skill name without the leading slash
    const mark = container.querySelector('mark');
    expect(mark?.textContent).toBe('commit');
    // full textContent still equals the raw value (slash hidden but present)
    expect(container.textContent).toBe('/commit go');
  });

  it('renders plain text with no <mark> when nothing matches', () => {
    const { container } = render(
      <div>{renderSkillTokens('just text', skills, commands)}</div>
    );
    expect(container.querySelector('mark')).toBeNull();
    expect(container.textContent).toBe('just text');
  });
});
