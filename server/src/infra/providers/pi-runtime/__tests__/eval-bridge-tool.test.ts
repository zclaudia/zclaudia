import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { createEvalBridgeTool } from '../eval-tool.js';
import { __shutdownAllEvalKernelsForTests } from '../eval-kernel.js';

describe('Eval bridge tool module', () => {
  afterEach(async () => {
    await __shutdownAllEvalKernelsForTests();
  });

  it('evaluates an expression and returns its value', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-eval-bridge-'));
    const tool = createEvalBridgeTool(dir, { sessionId: 'eval-bridge-test' }) as any;

    const result = await tool.execute('e1', { code: '1 + 1' });

    rmSync(dir, { recursive: true, force: true });
    expect(result.details.ok).toBe(true);
    expect(result.content[0].text).toContain('2');
  });

  it('requires code', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-eval-bridge-'));
    const tool = createEvalBridgeTool(dir, { sessionId: 'eval-bridge-missing-code' }) as any;

    const result = await tool.execute('e1', {});

    rmSync(dir, { recursive: true, force: true });
    expect(result.details.error).toBe('missing_code');
  });
});
