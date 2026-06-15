import { describe, expect, it } from 'vitest';

import { ToolCallTelemetry } from '../tool-telemetry.js';

describe('ToolCallTelemetry', () => {
  it('counts tools, output bytes, repeated reads, and repeated mutations', () => {
    const telemetry = new ToolCallTelemetry();

    telemetry.record('Read', { path: 'src/app.ts' }, {
      content: [{ type: 'text', text: 'one' }],
      details: { ok: true },
    });
    const readAgain = telemetry.record('Read', { path: 'src/app.ts' }, {
      content: [{ type: 'text', text: 'two' }],
      details: { ok: true },
    });
    telemetry.record('Edit', { file_path: 'src/app.ts' }, {
      content: [{ type: 'text', text: 'three' }],
      details: { ok: true },
    });
    const snapshot = telemetry.record('Edit', { file_path: 'src/app.ts' }, {
      content: [{ type: 'text', text: 'four' }],
      details: { ok: true },
    }).snapshot;

    expect(readAgain.advisories[0]).toContain('twice');
    expect(snapshot).toMatchObject({
      totalCalls: 4,
      toolCounts: { Read: 2, Edit: 2 },
      repeatedReads: { 'src/app.ts': 2 },
      repeatedMutations: { 'src/app.ts': 2 },
      bashRoutingBlocked: 0,
    });
    expect(snapshot.outputBytes).toBe(Buffer.byteLength('onetwothreefour', 'utf8'));
  });

  it('marks Bash routing blocks as notable', () => {
    const telemetry = new ToolCallTelemetry();
    const record = telemetry.record('Bash', { command: 'ls src' }, {
      content: [{ type: 'text', text: 'Use LS' }],
      details: { ok: false, error: 'bash_tool_routing_blocked' },
    });

    expect(record.notable).toBe(true);
    expect(record.snapshot.bashRoutingBlocked).toBe(1);
  });
});
