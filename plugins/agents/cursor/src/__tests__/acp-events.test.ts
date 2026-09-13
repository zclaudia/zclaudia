import { describe, expect, it } from 'vitest';
import { AcpEventMapper } from '../acp-events.js';

/** Build the mapper with an inline decision table. */
function makeMapper(decisions = {}, mode = undefined) {
  const violations: Array<{ toolCallId: string; kind: string | undefined }> = [];
  const mapper = new AcpEventMapper({
    zclaudiaMode: mode,
    decisionFor: id => decisions[id],
    onMutatingToolViolation: (toolCallId, kind) => {
      violations.push({ toolCallId, kind });
    },
  });
  return { mapper, violations };
}

const upd = (update: Record<string, unknown>) => update as never;

describe('AcpEventMapper', () => {
  it('maps agent_message_chunk to assistant_delta and thought chunks to thinking_delta', () => {
    const { mapper } = makeMapper();
    expect(
      mapper.applyUpdate(
        upd({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } })
      )
    ).toEqual([{ type: 'assistant_delta', content: 'hi' }]);
    expect(
      mapper.applyUpdate(
        upd({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'hmm' } })
      )
    ).toEqual([{ type: 'thinking_delta', thinkingContent: 'hmm' }]);
  });

  it('drops user_message_chunk outside replay instead of duplicating user content', () => {
    const { mapper } = makeMapper();
    expect(
      mapper.applyUpdate(
        upd({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'x' } })
      )
    ).toEqual([]);
  });

  it('suppresses everything during load replay, including user chunks (§7.3)', () => {
    const { mapper } = makeMapper();
    mapper.replaying = true;
    expect(
      mapper.applyUpdate(
        upd({
          sessionUpdate: 'user_message_chunk',
          content: { type: 'text', text: 'old question' },
        })
      )
    ).toEqual([]);
    expect(
      mapper.applyUpdate(
        upd({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'old answer' } })
      )
    ).toEqual([]);
    // Commands from replay are still absorbed for autocomplete.
    mapper.applyUpdate(
      upd({
        sessionUpdate: 'available_commands_update',
        availableCommands: [{ name: 'review', description: '' }],
      })
    );
    expect(mapper.currentSlashCommands()).toEqual(['review']);
    mapper.replaying = false;
    expect(
      mapper.applyUpdate(
        upd({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'new' } })
      )
    ).toEqual([{ type: 'assistant_delta', content: 'new' }]);
  });

  it('never emits the MCP placeholder title as the final tool name (§9.1)', () => {
    const { mapper } = makeMapper({ m1: 'allowed' });
    const events = [
      ...mapper.applyUpdate(
        upd({
          sessionUpdate: 'tool_call',
          toolCallId: 'm1',
          title: 'MCP: tool',
          kind: 'other',
          status: 'pending',
          rawInput: {},
        })
      ),
      ...mapper.applyUpdate(
        upd({
          sessionUpdate: 'tool_call_update',
          toolCallId: 'm1',
          title: 'zclaudia-probe: probe_ping',
          rawInput: { providerIdentifier: 'p', toolName: 't', args: {} },
        })
      ),
    ];
    const started = events.find(e => e.type === 'tool_started');
    expect(started).toBeDefined();
    expect(started!.toolName).toBe('zclaudia-probe: probe_ping');
    expect(JSON.stringify(events)).not.toContain('MCP: tool');
  });

  it('defers tool_started until the accumulator holds meaningful data (§9.1)', () => {
    const { mapper } = makeMapper({ p1: 'allowed' });
    const first = mapper.applyUpdate(
      upd({
        sessionUpdate: 'tool_call',
        toolCallId: 'p1',
        title: 'MCP: tool',
        kind: 'other',
        status: 'pending',
        rawInput: {},
      })
    );
    expect(first).toEqual([]);
    const second = mapper.applyUpdate(
      upd({ sessionUpdate: 'tool_call_update', toolCallId: 'p1', status: 'in_progress' })
    );
    expect(second.map(e => e.type)).toContain('tool_started');
  });

  it('renders denied tool calls as errors even though the agent reported completed (§9.2)', () => {
    const { mapper } = makeMapper({ t1: 'denied' });
    const events = [
      ...mapper.applyUpdate(
        upd({
          sessionUpdate: 'tool_call',
          toolCallId: 't1',
          title: 'Bash',
          kind: 'execute',
          status: 'pending',
          rawInput: { command: 'x' },
        })
      ),
      ...mapper.applyUpdate(
        upd({
          sessionUpdate: 'tool_call_update',
          toolCallId: 't1',
          status: 'completed',
          rawOutput: { success: true },
        })
      ),
    ];
    const finished = events.find(e => e.type === 'tool_finished');
    expect(finished).toBeDefined();
    expect(finished!.isToolError).toBe(true);
    expect(String(finished!.toolResult)).toContain('Denied by user');
    // The raw successful output must not be presented as the result.
    expect(JSON.stringify(finished)).not.toContain('success');
  });

  it('treats cancelled decisions like denials', () => {
    const { mapper } = makeMapper({ c1: 'cancelled' });
    const events = [
      ...mapper.applyUpdate(
        upd({
          sessionUpdate: 'tool_call',
          toolCallId: 'c1',
          title: 'Bash',
          kind: 'execute',
          status: 'pending',
          rawInput: {},
        })
      ),
      ...mapper.applyUpdate(
        upd({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'completed' })
      ),
    ];
    const finished = events.find(e => e.type === 'tool_finished');
    expect(finished!.isToolError).toBe(true);
    expect(String(finished!.toolResult)).toContain('Cancelled');
  });

  it('trusts ACP status only when no permission decision exists or it allowed', () => {
    const allowed = makeMapper({ a1: 'allowed' }).mapper;
    const events = [
      ...allowed.applyUpdate(
        upd({
          sessionUpdate: 'tool_call',
          toolCallId: 'a1',
          title: 'Bash',
          kind: 'read',
          status: 'pending',
          rawInput: {},
        })
      ),
      ...allowed.applyUpdate(
        upd({
          sessionUpdate: 'tool_call_update',
          toolCallId: 'a1',
          status: 'completed',
          rawOutput: 'result text',
        })
      ),
    ];
    const finished = events.find(e => e.type === 'tool_finished');
    expect(finished!.isToolError).toBe(false);
    expect(String(finished!.toolResult)).toContain('result text');
  });

  it('is idempotent on duplicate terminal updates (§9)', () => {
    const { mapper } = makeMapper({ t1: 'allowed' });
    mapper.applyUpdate(
      upd({
        sessionUpdate: 'tool_call',
        toolCallId: 't1',
        title: 'Bash',
        kind: 'execute',
        status: 'pending',
        rawInput: {},
      })
    );
    mapper.applyUpdate(
      upd({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed' })
    );
    const replayed = mapper.applyUpdate(
      upd({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed' })
    );
    expect(replayed).toEqual([]);
  });

  it('creates a placeholder accumulator for updates arriving before their tool_call (§9)', () => {
    const { mapper } = makeMapper({ o1: 'allowed' });
    const events = [
      ...mapper.applyUpdate(
        upd({
          sessionUpdate: 'tool_call_update',
          toolCallId: 'o1',
          title: 'Late Tool',
          status: 'completed',
          rawOutput: 1,
        })
      ),
    ];
    expect(events.map(e => e.type)).toEqual(['tool_started', 'tool_finished']);
    expect(events[0].toolName).toBe('Late Tool');
  });

  it('preserves a meaningful out-of-order tool name when the initial call arrives later', () => {
    const { mapper } = makeMapper({ o2: 'allowed' });
    const events = [
      ...mapper.applyUpdate(
        upd({
          sessionUpdate: 'tool_call_update',
          toolCallId: 'o2',
          title: 'zclaudia-probe: probe_ping',
          status: 'pending',
        })
      ),
      ...mapper.applyUpdate(
        upd({
          sessionUpdate: 'tool_call',
          toolCallId: 'o2',
          title: 'MCP: tool',
          kind: 'other',
          status: 'in_progress',
          rawInput: {},
        })
      ),
    ];
    expect(events.length).toBeGreaterThan(0);
    expect(events.every(event => event.toolName === 'zclaudia-probe: probe_ping')).toBe(true);
  });

  it('flags mutating tools executing in plan mode without permission as violations (§8.3)', () => {
    const { mapper, violations } = makeMapper({}, 'plan');
    mapper.applyUpdate(
      upd({
        sessionUpdate: 'tool_call',
        toolCallId: 'v1',
        title: 'Edit',
        kind: 'edit',
        status: 'pending',
        rawInput: {},
      })
    );
    expect(violations).toEqual([]);
    mapper.applyUpdate(
      upd({ sessionUpdate: 'tool_call_update', toolCallId: 'v1', status: 'in_progress' })
    );
    expect(violations).toEqual([{ toolCallId: 'v1', kind: 'edit' }]);
  });

  it('does not flag read-only tools or allowed mutations in plan mode', () => {
    const { mapper, violations } = makeMapper({ r1: 'allowed' }, 'plan');
    mapper.applyUpdate(
      upd({
        sessionUpdate: 'tool_call',
        toolCallId: 'r0',
        title: 'Grep',
        kind: 'search',
        status: 'pending',
        rawInput: {},
      })
    );
    mapper.applyUpdate(
      upd({ sessionUpdate: 'tool_call_update', toolCallId: 'r0', status: 'in_progress' })
    );
    mapper.applyUpdate(
      upd({
        sessionUpdate: 'tool_call',
        toolCallId: 'r1',
        title: 'Edit',
        kind: 'edit',
        status: 'pending',
        rawInput: {},
      })
    );
    mapper.applyUpdate(
      upd({ sessionUpdate: 'tool_call_update', toolCallId: 'r1', status: 'in_progress' })
    );
    expect(violations).toEqual([]);
  });

  it('does not flag "other"-kind tools by kind alone (MCP/create_plan use it)', () => {
    const { mapper, violations } = makeMapper({}, 'ask');
    mapper.applyUpdate(
      upd({
        sessionUpdate: 'tool_call',
        toolCallId: 'm1',
        title: 'MCP: tool',
        kind: 'other',
        status: 'pending',
        rawInput: {},
      })
    );
    mapper.applyUpdate(
      upd({ sessionUpdate: 'tool_call_update', toolCallId: 'm1', status: 'in_progress' })
    );
    expect(violations).toEqual([]);
  });

  it('bounds large tool outputs with a truncation marker', () => {
    const { mapper } = makeMapper({ t1: 'allowed' });
    mapper.applyUpdate(
      upd({
        sessionUpdate: 'tool_call',
        toolCallId: 't1',
        title: 'Read',
        kind: 'read',
        status: 'pending',
        rawInput: {},
      })
    );
    const events = mapper.applyUpdate(
      upd({
        sessionUpdate: 'tool_call_update',
        toolCallId: 't1',
        status: 'completed',
        rawOutput: 'x'.repeat(1024 * 1024),
      })
    );
    const finished = events.find(e => e.type === 'tool_finished')!;
    expect(String(finished.toolResult).length).toBeLessThan(1024 * 1024);
  });

  it('ignores session_info_update and compaction updates (no v1 contract)', () => {
    const { mapper } = makeMapper();
    expect(mapper.applyUpdate(upd({ sessionUpdate: 'session_info_update', title: 't' }))).toEqual(
      []
    );
    expect(mapper.applyUpdate(upd({ sessionUpdate: 'compaction_update' }))).toEqual([]);
  });

  it('surfaces an unsolicited mode change as a mode_transition', () => {
    const { mapper } = makeMapper();
    const events = mapper.applyUpdate(
      upd({ sessionUpdate: 'current_mode_update', currentModeId: 'plan' })
    );
    expect(events[0].type).toBe('mode_transition');
    expect(events[0].modeTransition?.mode).toBe('plan');
  });
});
