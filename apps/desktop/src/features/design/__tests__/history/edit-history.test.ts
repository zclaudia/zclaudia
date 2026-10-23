import { describe, expect, it } from 'vitest';
import { EditHistory } from '../../history/edit-history';

const entry = (before: string, after: string, at: number, label = 'edit') => ({
  before,
  after,
  label,
  at,
});

describe('EditHistory', () => {
  it('stacks records and undoes/redoes them in order', () => {
    const history = new EditHistory();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.undo('a')).toBeNull();

    history.record(entry('a', 'b', 0));
    history.record(entry('b', 'c', 1));
    expect(history.canUndo).toBe(true);

    expect(history.undo('c')).toBe('b');
    expect(history.canRedo).toBe(true);
    expect(history.undo('b')).toBe('a');
    expect(history.undo('a')).toBeNull(); // bottom reached

    expect(history.redo('a')).toBe('b');
    expect(history.redo('b')).toBe('c');
    expect(history.redo('c')).toBeNull();
  });

  it('merges consecutive records with the same mergeKey inside the window', () => {
    const history = new EditHistory({ mergeWindowMs: 1500 });
    history.record({ ...entry('a', 'ab', 1000, 'typing'), mergeKey: '0.0:text' });
    history.record({ ...entry('ab', 'abc', 2000, 'typing'), mergeKey: '0.0:text' });
    history.record({ ...entry('abc', 'abcd', 2400, 'typing'), mergeKey: '0.0:text' });

    expect(history.canUndo).toBe(true);
    expect(history.undo('abcd')).toBe('a'); // single merged entry keeps the original `before`
    expect(history.canUndo).toBe(false);

    // beyond the merge window a new entry is pushed
    history.record({ ...entry('a', 'ab', 1000, 'typing'), mergeKey: '0.0:text' });
    history.record({ ...entry('ab', 'abc', 1000 + 1500, 'typing'), mergeKey: '0.0:text' });
    expect(history.undo('abc')).toBe('ab');
    expect(history.undo('ab')).toBe('a');
  });

  it('does not merge entries with different merge keys', () => {
    const history = new EditHistory();
    history.record({ ...entry('a', 'b', 0), mergeKey: '0.0:text' });
    history.record({ ...entry('b', 'c', 100), mergeKey: '0.0:style:color' });
    expect(history.undo('c')).toBe('b');
    expect(history.undo('b')).toBe('a');
  });

  it('clears the redo stack on every new record', () => {
    const history = new EditHistory();
    history.record(entry('a', 'b', 0));
    expect(history.undo('b')).toBe('a');
    expect(history.canRedo).toBe(true);

    history.record(entry('a', 'x', 1));
    expect(history.canRedo).toBe(false);
    expect(history.redo('x')).toBeNull();
  });

  it('keeps undoing after markSaved and exposes the saved baseline', () => {
    const history = new EditHistory();
    history.record(entry('a', 'b', 0));
    history.markSaved('b');
    expect(history.savedSource).toBe('b');
    expect(history.canUndo).toBe(true); // saving does not clear the history
    expect(history.undo('b')).toBe('a');
    expect(history.savedSource).toBe('b');
  });

  it('clears everything on rebuild', () => {
    const history = new EditHistory();
    history.record(entry('a', 'b', 0));
    history.record(entry('b', 'c', 1));
    history.undo('c');
    history.rebuild('fresh');
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.undo('fresh')).toBeNull();
    expect(history.redo('fresh')).toBeNull();
    expect(history.savedSource).toBe('fresh');
  });

  it('evicts the oldest entries beyond limit', () => {
    const history = new EditHistory({ limit: 2 });
    history.record(entry('a', 'b', 0));
    history.record(entry('b', 'c', 1));
    history.record(entry('c', 'd', 2));

    expect(history.undo('d')).toBe('c');
    expect(history.undo('c')).toBe('b');
    expect(history.undo('b')).toBeNull(); // the a→b entry was evicted
    expect(history.canRedo).toBe(true);
  });

  it('evicts the oldest entries beyond maxBytes', () => {
    // Entries chain (before === previous after); the cap counts before+after lengths.
    const history = new EditHistory({ maxBytes: 12 });
    history.record(entry('aaaaaaaaaa', 'bbbbbbbbbb', 0)); // 20 bytes > 12 → evicted, even alone
    expect(history.canUndo).toBe(false);

    history.record(entry('ab', 'cd', 1)); // 4 bytes
    history.record(entry('cd', 'ef', 2)); // 4 bytes
    history.record(entry('ef', 'gh', 3)); // 4 bytes → 12 total, still fits
    expect(history.canUndo).toBe(true);

    history.record(entry('gh', 'ij', 4)); // pushes to 16 → oldest (ab→cd) evicted
    expect(history.undo('ij')).toBe('gh');
    expect(history.undo('gh')).toBe('ef');
    expect(history.undo('ef')).toBe('cd');
    expect(history.undo('cd')).toBeNull(); // the ab→cd entry was evicted
  });

  it('returns null and rebuilds when undo sees an externally changed draft', () => {
    const history = new EditHistory();
    history.record(entry('a', 'b', 0));
    history.record(entry('b', 'c', 1));

    expect(history.undo('external')).toBeNull();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.savedSource).toBe('external');
    expect(history.undo('external')).toBeNull();
  });

  it('returns null and rebuilds when redo sees an externally changed draft', () => {
    const history = new EditHistory();
    history.record(entry('a', 'b', 0));
    history.undo('b');
    expect(history.canRedo).toBe(true);

    expect(history.redo('tampered')).toBeNull();
    expect(history.canRedo).toBe(false);
    expect(history.canUndo).toBe(false);
    expect(history.savedSource).toBe('tampered');
  });

  it('keeps the redo target when redo is called with the matching draft', () => {
    const history = new EditHistory();
    history.record(entry('a', 'b', 0));
    history.record(entry('b', 'c', 1));
    history.undo('c');
    history.undo('b');
    history.record(entry('b', 'z', 2)); // new record discards redo
    expect(history.canRedo).toBe(false);
    expect(history.undo('z')).toBe('b');
    expect(history.undo('b')).toBeNull(); // the undone entries stay discarded
  });
});
