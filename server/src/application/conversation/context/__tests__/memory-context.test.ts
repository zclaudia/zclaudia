import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildMemoryContext, MAX_INDEX_LINES, MAX_INDEX_BYTES } from '../memory-context.js';

let memoryDir: string;

beforeEach(() => {
  memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zclaudia-memctx-test-'));
});

afterEach(() => {
  fs.rmSync(memoryDir, { recursive: true, force: true });
});

describe('buildMemoryContext', () => {
  it('returns undefined when MEMORY.md is missing or empty (silent non-injection)', () => {
    expect(buildMemoryContext(memoryDir)).toBeUndefined();
    fs.writeFileSync(path.join(memoryDir, 'MEMORY.md'), '   \n  ');
    expect(buildMemoryContext(memoryDir)).toBeUndefined();
  });

  it('wraps the index with guidance when present', () => {
    fs.writeFileSync(path.join(memoryDir, 'MEMORY.md'), '- [Layout decision](layout.md) — shared builds first');
    const result = buildMemoryContext(memoryDir)!;
    expect(result).toContain('/memories');
    expect(result).toContain('Layout decision');
  });

  it('truncates oversized indexes by lines and bytes with a marker', () => {
    const manyLines = Array.from({ length: MAX_INDEX_LINES + 50 }, (_, i) => `- line ${i}`).join(
      '\n'
    );
    fs.writeFileSync(path.join(memoryDir, 'MEMORY.md'), manyLines);
    const byLines = buildMemoryContext(memoryDir)!;
    expect(byLines).toContain('[index truncated');
    expect(byLines).not.toContain(`- line ${MAX_INDEX_LINES + 10}`);

    const cjkLines = Array.from(
      { length: 90 },
      (_, i) =>
        `- Memory and caching ${i}: ` +
        'Lessons learned about build order and cache stability. Design patterns, permission rules, hooks, subscriptions, event streams. '.repeat(3)
    ).join('\n');
    fs.writeFileSync(path.join(memoryDir, 'MEMORY.md'), cjkLines);
    const byBytes = buildMemoryContext(memoryDir)!;
    expect(Buffer.byteLength(byBytes, 'utf8')).toBeLessThan(MAX_INDEX_BYTES + 2000);
    expect(byBytes).toContain('[index truncated');
    expect(byBytes).not.toContain('�');
  });
});
