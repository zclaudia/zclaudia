import { describe, expect, it, vi } from 'vitest';
import type { AgentTool } from '@earendil-works/pi-agent-core';

import {
  ToolScheduler,
  ToolTimeoutError,
  applyToolScheduler,
  resolveToolSchedulePolicy,
  withToolScheduler,
} from '../tool-scheduler.js';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeTool(name: string, execute: NonNullable<AgentTool['execute']>): AgentTool {
  return {
    name,
    label: name,
    description: name,
    parameters: { type: 'object', properties: {} },
    execute,
  } as AgentTool;
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('resolveToolSchedulePolicy', () => {
  it('derives shared/exclusive from builtin metadata', () => {
    expect(resolveToolSchedulePolicy('Read').concurrency).toBe('shared');
    expect(resolveToolSchedulePolicy('Grep').concurrency).toBe('shared');
    expect(resolveToolSchedulePolicy('Edit').concurrency).toBe('exclusive');
    expect(resolveToolSchedulePolicy('Write').concurrency).toBe('exclusive');
    expect(resolveToolSchedulePolicy('Bash').concurrency).toBe('exclusive');
    expect(resolveToolSchedulePolicy('Eval').concurrency).toBe('exclusive');
    expect(resolveToolSchedulePolicy('MCPTool').concurrency).toBe('exclusive');
  });

  it('lets sub-agents fan out and never gates blocking interaction tools', () => {
    expect(resolveToolSchedulePolicy('Agent').concurrency).toBe('shared');
    expect(resolveToolSchedulePolicy('AskUserQuestion').concurrency).toBe('unscheduled');
    expect(resolveToolSchedulePolicy('ExitPlanMode').concurrency).toBe('unscheduled');
  });

  it('resolves legacy aliases to the canonical builtin policy', () => {
    expect(resolveToolSchedulePolicy('bash').concurrency).toBe('exclusive');
    expect(resolveToolSchedulePolicy('read').concurrency).toBe('shared');
  });

  it('treats meta tools as shared and unknown/MCP tools as exclusive', () => {
    expect(resolveToolSchedulePolicy('SearchSkills').concurrency).toBe('shared');
    expect(resolveToolSchedulePolicy('LoadExternalTool').concurrency).toBe('shared');
    expect(resolveToolSchedulePolicy('mcp__fs__write_file').concurrency).toBe('exclusive');
    expect(resolveToolSchedulePolicy('SomethingNew').concurrency).toBe('exclusive');
  });

  it('carries the per-tool timeout budget from metadata', () => {
    expect(resolveToolSchedulePolicy('Read').timeoutMs).toBe(120_000);
    expect(resolveToolSchedulePolicy('Bash').timeoutMs).toBeUndefined();
    expect(resolveToolSchedulePolicy('Agent').timeoutMs).toBeUndefined();
  });
});

describe('ToolScheduler', () => {
  it('runs shared calls together under the cap', async () => {
    const scheduler = new ToolScheduler({ maxConcurrency: 2 });
    const r1 = await scheduler.acquire('shared');
    const r2 = await scheduler.acquire('shared');
    let thirdStarted = false;
    const third = scheduler.acquire('shared').then(release => {
      thirdStarted = true;
      return release;
    });
    await tick();
    expect(thirdStarted).toBe(false);
    expect(scheduler.snapshot()).toEqual({ activeShared: 2, exclusiveActive: false, queued: 1 });

    r1();
    const r3 = await third;
    expect(thirdStarted).toBe(true);
    r2();
    r3();
    expect(scheduler.snapshot()).toEqual({ activeShared: 0, exclusiveActive: false, queued: 0 });
  });

  it('exclusive waits for in-flight shared calls to drain and blocks later shared calls', async () => {
    const scheduler = new ToolScheduler();
    const releaseShared = await scheduler.acquire('shared');

    const order: string[] = [];
    const exclusive = scheduler.acquire('exclusive').then(release => {
      order.push('exclusive');
      return release;
    });
    const laterShared = scheduler.acquire('shared').then(release => {
      order.push('shared-2');
      return release;
    });
    await tick();
    expect(order).toEqual([]);

    releaseShared();
    const releaseExclusive = await exclusive;
    await tick();
    // The queued shared call must not start while the exclusive holds the lock.
    expect(order).toEqual(['exclusive']);
    expect(scheduler.snapshot().exclusiveActive).toBe(true);

    releaseExclusive();
    const releaseLater = await laterShared;
    expect(order).toEqual(['exclusive', 'shared-2']);
    releaseLater();
  });

  it('serializes consecutive exclusive calls in FIFO order', async () => {
    const scheduler = new ToolScheduler();
    const order: number[] = [];
    const runs = [1, 2, 3].map(async n => {
      const release = await scheduler.acquire('exclusive');
      order.push(n);
      await tick();
      release();
    });
    await Promise.all(runs);
    expect(order).toEqual([1, 2, 3]);
  });

  it('rejects a queued acquire when its signal aborts and keeps pumping', async () => {
    const scheduler = new ToolScheduler({ maxConcurrency: 1 });
    const release = await scheduler.acquire('shared');
    const controller = new AbortController();
    const aborted = scheduler.acquire('shared', controller.signal);
    const survivor = scheduler.acquire('shared');
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
    release();
    const releaseSurvivor = await survivor;
    releaseSurvivor();
    expect(scheduler.snapshot().queued).toBe(0);
  });

  it('release is idempotent', async () => {
    const scheduler = new ToolScheduler();
    const release = await scheduler.acquire('shared');
    release();
    release();
    expect(scheduler.snapshot().activeShared).toBe(0);
  });
});

describe('withToolScheduler', () => {
  it('holds an Edit until an in-flight Bash completes (no Bash/Edit race)', async () => {
    const scheduler = new ToolScheduler();
    const bashGate = deferred();
    const events: string[] = [];
    const bash = withToolScheduler(
      fakeTool('Bash', async () => {
        events.push('bash:start');
        await bashGate.promise;
        events.push('bash:end');
        return { content: [], details: {} };
      }),
      scheduler
    );
    const edit = withToolScheduler(
      fakeTool('Edit', async () => {
        events.push('edit:start');
        return { content: [], details: {} };
      }),
      scheduler
    );

    const bashRun = bash.execute!('1', {}, undefined, undefined);
    const editRun = edit.execute!('2', {}, undefined, undefined);
    await tick();
    expect(events).toEqual(['bash:start']);
    bashGate.resolve();
    await Promise.all([bashRun, editRun]);
    expect(events).toEqual(['bash:start', 'bash:end', 'edit:start']);
  });

  it('lets two Reads overlap', async () => {
    const scheduler = new ToolScheduler();
    const gate = deferred();
    let started = 0;
    const read = withToolScheduler(
      fakeTool('Read', async () => {
        started += 1;
        await gate.promise;
        return { content: [], details: {} };
      }),
      scheduler
    );
    const a = read.execute!('1', {}, undefined, undefined);
    const b = read.execute!('2', {}, undefined, undefined);
    await tick();
    expect(started).toBe(2);
    gate.resolve();
    await Promise.all([a, b]);
  });

  it('does not gate AskUserQuestion at all', () => {
    const scheduler = new ToolScheduler();
    const tool = fakeTool('AskUserQuestion', async () => ({ content: [], details: {} }));
    expect(withToolScheduler(tool, scheduler)).toBe(tool);
  });

  it('rejects with ToolTimeoutError and aborts the inner signal on overrun', async () => {
    vi.useFakeTimers();
    try {
      const scheduler = new ToolScheduler();
      let innerSignal: AbortSignal | undefined;
      const slow = withToolScheduler(
        fakeTool(
          'Read',
          (_id, _params, signal) =>
            new Promise((_, reject) => {
              innerSignal = signal as AbortSignal | undefined;
              signal?.addEventListener('abort', () => reject(signal.reason));
            })
        ),
        scheduler,
        { concurrency: 'shared', timeoutMs: 1_000 }
      );
      const run = slow.execute!('1', {}, undefined, undefined);
      const assertion = expect(run).rejects.toBeInstanceOf(ToolTimeoutError);
      await vi.advanceTimersByTimeAsync(1_000);
      await assertion;
      expect(innerSignal?.aborted).toBe(true);
      // The slot must be released after the timeout so later calls proceed.
      expect(scheduler.snapshot().activeShared).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('propagates the parent abort into the linked signal', async () => {
    const scheduler = new ToolScheduler();
    const parent = new AbortController();
    let innerSignal: AbortSignal | undefined;
    const tool = withToolScheduler(
      fakeTool(
        'Read',
        (_id, _params, signal) =>
          new Promise((_, reject) => {
            innerSignal = signal as AbortSignal | undefined;
            signal?.addEventListener('abort', () => reject(new Error('inner aborted')));
          })
      ),
      scheduler,
      { concurrency: 'shared', timeoutMs: 60_000 }
    );
    const run = tool.execute!('1', {}, parent.signal, undefined);
    await tick();
    parent.abort();
    await expect(run).rejects.toThrow('inner aborted');
    expect(innerSignal?.aborted).toBe(true);
  });

  it('bails before executing when the run is already aborted', async () => {
    const scheduler = new ToolScheduler();
    const execute = vi.fn(async () => ({ content: [], details: {} }));
    const tool = withToolScheduler(fakeTool('Read', execute), scheduler);
    const controller = new AbortController();
    controller.abort();
    await expect(tool.execute!('1', {}, controller.signal, undefined)).rejects.toBeTruthy();
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('applyToolScheduler', () => {
  it('wraps in place and keeps the array reference', () => {
    const original = fakeTool('Read', async () => ({ content: [], details: {} }));
    const tools = [original];
    const result = applyToolScheduler(tools);
    expect(result).toBe(tools);
    expect(tools[0]).not.toBe(original);
    expect(tools[0].name).toBe('Read');
  });
});
