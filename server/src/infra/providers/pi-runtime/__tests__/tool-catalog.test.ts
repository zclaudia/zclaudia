import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { ALL_TOOL_NAMES, type ToolName } from '@zclaudia/shared/core/tools';
import { BUILTIN_TOOL_FACTORIES } from '../tool-catalog.js';

// Runtime smoke test: the Record<ToolName, ToolFactory> type guarantees a
// factory EXISTS for every name, but only construction proves the factory
// actually builds a well-formed tool (schema, execute) without throwing.
describe('BUILTIN_TOOL_FACTORIES', () => {
  const tempDirs: string[] = [];

  afterEach(() => tempDirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));

  it('covers every ToolName exactly once', () => {
    expect(Object.keys(BUILTIN_TOOL_FACTORIES).sort()).toEqual([...ALL_TOOL_NAMES].sort());
  });

  it.each([...ALL_TOOL_NAMES])('constructs %s without throwing', (name: ToolName) => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'zc-catalog-'));
    tempDirs.push(cwd);
    const tool = BUILTIN_TOOL_FACTORIES[name](cwd, { memoryDir: path.join(cwd, 'memory') });

    expect(tool.name).toBe(name);
    expect(typeof tool.description).toBe('string');
    expect(tool.parameters).toBeTruthy();
    expect(typeof tool.execute).toBe('function');
  });
});
