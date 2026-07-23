import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { buildAgentHooks } from '../agent-hooks.js';

const allowAll = async () => ({ behavior: 'allow' as const });

function textBlocks(text: string) {
  return [{ type: 'text', text }];
}

function callCtx(toolName: string, text: string, details: Record<string, unknown> = {}): any {
  return {
    toolCall: { name: toolName, id: `tc-${Math.random().toString(36).slice(2)}` },
    args: {},
    result: { content: textBlocks(text), details },
  };
}

describe('per-turn tool result budget', () => {
  let dataDir: string;
  let prevDataDir: string | undefined;

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'zc-budget-data-'));
    prevDataDir = process.env.ZCLAUDIA_DATA_DIR;
    process.env.ZCLAUDIA_DATA_DIR = dataDir;
  });

  afterEach(() => {
    if (prevDataDir === undefined) delete process.env.ZCLAUDIA_DATA_DIR;
    else process.env.ZCLAUDIA_DATA_DIR = prevDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  function hooks(budgetBytes: number) {
    return buildAgentHooks({
      permissionCallback: allowAll,
      outputTruncationLimit: 1024 * 1024,
      toolResultBudgetBytes: budgetBytes,
    });
  }

  it('results within the budget pass through unchanged', async () => {
    const h = hooks(20_000);
    const out = await h.afterToolCall!(callCtx('Grep', 'x'.repeat(8000)));
    expect(out).toBeUndefined();
  });

  it('persists an oversize result once the turn budget is exhausted', async () => {
    const h = hooks(15_000);
    const first = await h.afterToolCall!(callCtx('Grep', 'a'.repeat(8000)));
    expect(first).toBeUndefined();

    const bigText = 'needle-at-start ' + 'b'.repeat(8000) + ' needle-at-end';

    const second: any = await h.afterToolCall!(callCtx('Grep', bigText));
    expect(second).toBeDefined();
    expect(second.details.budgetExceeded).toBe(true);
    expect(typeof second.details.persistedPath).toBe('string');

    // Full content lands on disk; the in-context replacement is a short preview + pointer.
    const onDisk = readFileSync(second.details.persistedPath, 'utf8');
    expect(onDisk).toContain('needle-at-start');
    expect(onDisk).toContain('needle-at-end');
    const inContext = second.content.map((b: { text?: string }) => b.text ?? '').join('\n');
    expect(inContext.length).toBeLessThan(3000);
    expect(inContext).toContain(second.details.persistedPath);
  });

  it('small results still pass after the budget is exhausted', async () => {
    const h = hooks(10_000);
    await h.afterToolCall!(callCtx('Grep', 'a'.repeat(9000)));
    const out = await h.afterToolCall!(callCtx('LS', 'short result'));
    expect(out).toBeUndefined();
  });

  it('the budget resets at the turn boundary', async () => {
    const h = hooks(10_000);
    await h.afterToolCall!(callCtx('Grep', 'a'.repeat(9000)));

    const over: any = await h.afterToolCall!(callCtx('Grep', 'c'.repeat(9000)));
    expect(over?.details?.budgetExceeded).toBe(true);

    await h.shouldStopAfterTurn!({} as never);

    const fresh = await h.afterToolCall!(callCtx('Grep', 'd'.repeat(9000)));
    expect(fresh).toBeUndefined();
  });

  it('budget 0 disables persistence entirely', async () => {
    const h = hooks(0);
    const out = await h.afterToolCall!(callCtx('Grep', 'a'.repeat(50_000)));
    expect(out).toBeUndefined();
  });

  it('non-text blocks (images) are never persisted', async () => {
    const h = hooks(5_000);
    await h.afterToolCall!(callCtx('Grep', 'a'.repeat(4_500)));
    const ctx = {
      toolCall: { name: 'Read', id: 'tc-img' },
      args: {},
      result: {
        content: [
          { type: 'image', source: { type: 'base64', data: 'x'.repeat(9000) } },
          { type: 'text', text: 'y'.repeat(9000) },
        ],
        details: {},
      },
    };

    const out: any = await h.afterToolCall!(ctx as never);
    expect(out.details.budgetExceeded).toBe(true);
    // image block survives in context, only text was persisted
    expect(out.content.some((b: { type: string }) => b.type === 'image')).toBe(true);
    expect(existsSync(out.details.persistedPath)).toBe(true);
  });

  it('a result that is BOTH truncated and persisted keeps both flags distinctly', async () => {
    const h = buildAgentHooks({
      permissionCallback: allowAll,
      outputTruncationLimit: 6_000,
      toolResultBudgetBytes: 5_000,
    });
    // Multi-line so head-truncation keeps a substantial (>4KiB) preview:
    // pi's truncateHead is line-aware and drops an over-budget single line whole.
    const text = Array.from({ length: 200 }, () => 'z'.repeat(39)).join('\n'); // 7999 bytes

    const out: any = await h.afterToolCall!(callCtx('Grep', text));

    // Output-limit truncation happened (7999 > 6000) AND the truncated result
    // still blew the turn budget (6000+ > 5000), so it was persisted.
    expect(out.details.truncated).toBe(true);
    expect(out.details.truncatedOriginalSize).toBe(Buffer.byteLength(text, 'utf8'));
    expect(out.details.budgetExceeded).toBe(true);
    expect(typeof out.details.persistedPath).toBe('string');
    // `originalSize` measures the persisted full text — no ambiguity with the
    // truncation size now that truncatedOriginalSize carries the latter.
    expect(out.details.originalSize).toBe(Buffer.byteLength(text, 'utf8'));
  });
});
