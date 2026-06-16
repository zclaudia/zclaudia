import { describe, it, expect } from 'vitest';
import { buildFileDiff } from '../diff.js';

const lines = (n: number, prefix = 'L') => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
const join = (arr: string[]) => arr.join('\n') + '\n';

describe('buildFileDiff', () => {
  it('reports no change for identical content', () => {
    const r = buildFileDiff('f', join(lines(50)), join(lines(50)));
    expect(r.firstChangedLine).toBeUndefined();
    expect(r.structuredPatch).toEqual([]);
    expect(r.lineChanges).toEqual({ additions: 0, deletions: 0, changes: 0 });
  });

  it('a localized length-changing edit does NOT cascade to the rest of the file', () => {
    // The regression: replace 4 lines at line 48 with 11 lines in a 1065-line
    // file. Old code reported +1008/-1001 (whole file). Correct answer: -4/+11.
    const old = lines(1065);
    const updated = [
      ...old.slice(0, 47),               // lines 1..47 unchanged
      ...lines(11, 'NEW'),               // 11 replacement lines at line 48
      ...old.slice(51),                  // lines 52..1065 unchanged (shifted +7)
    ];
    const r = buildFileDiff('kanban.py', join(old), join(updated));

    expect(r.firstChangedLine).toBe(48);
    expect(r.lineChanges).toEqual({ additions: 11, deletions: 4, changes: 15 });
    // Exactly one hunk, localized — not the whole file.
    expect(r.structuredPatch).toHaveLength(1);
    expect(r.structuredPatch[0].oldStart).toBe(45); // 48 - 3 context
    // The diff body must be bounded (changed region + context), not ~1065 lines.
    const bodyLines = r.diff.split('\n').length;
    expect(bodyLines).toBeLessThan(40);
    // Trailing unchanged lines must NOT appear as changes.
    expect(r.diff).not.toContain('-L1065');
    expect(r.diff).not.toContain('+L1065');
  });

  it('pure insertion in the middle', () => {
    const old = lines(20);
    const updated = [...old.slice(0, 10), 'INS1', 'INS2', ...old.slice(10)];
    const r = buildFileDiff('f', join(old), join(updated));
    expect(r.lineChanges).toEqual({ additions: 2, deletions: 0, changes: 2 });
    expect(r.firstChangedLine).toBe(11);
    expect(r.structuredPatch).toHaveLength(1);
  });

  it('pure deletion in the middle', () => {
    const old = lines(20);
    const updated = [...old.slice(0, 10), ...old.slice(13)]; // remove L11,L12,L13
    const r = buildFileDiff('f', join(old), join(updated));
    expect(r.lineChanges).toEqual({ additions: 0, deletions: 3, changes: 3 });
    expect(r.firstChangedLine).toBe(11);
  });

  it('two far-apart edits produce two separate hunks, not one giant block', () => {
    const old = lines(200);
    const updated = [...old];
    updated[10] = 'CHANGED_A'; // line 11
    updated[150] = 'CHANGED_B'; // line 151
    const r = buildFileDiff('f', join(old), join(updated));
    expect(r.lineChanges).toEqual({ additions: 2, deletions: 2, changes: 4 });
    expect(r.structuredPatch).toHaveLength(2);
    // Each hunk is small (context-bounded), not spanning the 140-line gap.
    for (const h of r.structuredPatch) expect(h.lines.length).toBeLessThan(12);
  });

  it('change at the very top of the file', () => {
    const old = lines(30);
    const updated = ['TOP', ...old.slice(1)];
    const r = buildFileDiff('f', join(old), join(updated));
    expect(r.firstChangedLine).toBe(1);
    expect(r.lineChanges).toEqual({ additions: 1, deletions: 1, changes: 2 });
    expect(r.structuredPatch).toHaveLength(1);
  });
});
