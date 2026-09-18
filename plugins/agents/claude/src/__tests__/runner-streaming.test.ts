import { describe, expect, it } from 'vitest';
import {
  pumpClaudeStream,
  transformClaudeSdkMessage,
  transformClaudeStreamEvent,
} from '../runner.js';

function streamEvent(event: unknown, parentToolUseId: string | null = null) {
  return {
    type: 'stream_event',
    event,
    parent_tool_use_id: parentToolUseId,
    uuid: 'u',
    session_id: 's',
  };
}

function textDelta(text: string) {
  return { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } };
}

function thinkingDelta(thinking: string) {
  return { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking } };
}

function fakeStream(messages: unknown[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const m of messages) yield m;
    },
    close() {},
  };
}

async function collect(messages: unknown[]) {
  const events = [];
  for await (const event of pumpClaudeStream(fakeStream(messages), {} as never)) {
    events.push(event);
  }
  return events;
}

describe('transformClaudeStreamEvent', () => {
  it('maps text deltas to assistant_delta', () => {
    expect(transformClaudeStreamEvent(textDelta('Hel'))).toEqual([
      { type: 'assistant_delta', content: 'Hel' },
    ]);
  });

  it('maps thinking and signature deltas to thinking_delta', () => {
    expect(transformClaudeStreamEvent(thinkingDelta('hmm'))).toEqual([
      { type: 'thinking_delta', thinkingContent: 'hmm' },
    ]);
    expect(
      transformClaudeStreamEvent({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'signature_delta', signature: 'sig' },
      })
    ).toEqual([{ type: 'thinking_delta', thinkingSignature: 'sig' }]);
  });

  it('ignores tool input deltas, empty deltas and lifecycle events', () => {
    expect(
      transformClaudeStreamEvent({
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"a":' },
      })
    ).toEqual([]);
    expect(transformClaudeStreamEvent(textDelta(''))).toEqual([]);
    expect(transformClaudeStreamEvent({ type: 'message_start' })).toEqual([]);
    expect(transformClaudeStreamEvent({ type: 'content_block_stop', index: 0 })).toEqual([]);
    expect(transformClaudeStreamEvent(undefined)).toEqual([]);
  });
});

describe('transformClaudeSdkMessage streaming', () => {
  it('drops sub-agent stream events', () => {
    expect(transformClaudeSdkMessage(streamEvent(textDelta('sub'), 'tool_1'))).toEqual([]);
  });

  it('forwards thinking blocks of a complete assistant message', () => {
    expect(
      transformClaudeSdkMessage({
        type: 'assistant',
        parent_tool_use_id: null,
        message: {
          content: [
            { type: 'thinking', thinking: 'plan', signature: 'sig' },
            { type: 'text', text: 'done' },
          ],
        },
      })
    ).toEqual([
      { type: 'thinking_delta', thinkingContent: 'plan', thinkingSignature: 'sig' },
      { type: 'assistant', content: 'done' },
    ]);
  });
});

describe('pumpClaudeStream delta dedup', () => {
  const streamedAssistant = {
    type: 'assistant',
    parent_tool_use_id: null,
    message: {
      id: 'msg_1',
      content: [
        { type: 'thinking', thinking: 'hmm', signature: 'sig' },
        { type: 'text', text: 'Hello' },
        { type: 'tool_use', id: 'tool_1', name: 'Read', input: { file_path: '/a' } },
      ],
    },
  };

  it('streams deltas and keeps only tool_use from the complete message', async () => {
    const events = await collect([
      streamEvent(thinkingDelta('hmm')),
      streamEvent({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'signature_delta', signature: 'sig' },
      }),
      streamEvent(textDelta('Hel')),
      streamEvent(textDelta('lo')),
      streamedAssistant,
    ]);
    expect(events.map(e => e.type)).toEqual([
      'thinking_delta',
      'thinking_delta',
      'assistant_delta',
      'assistant_delta',
      'tool_use',
    ]);
    expect(events.filter(e => e.type === 'assistant_delta').map(e => e.content)).toEqual([
      'Hel',
      'lo',
    ]);
    expect(events.at(-1)).toMatchObject({ type: 'tool_use', toolUseId: 'tool_1' });
  });

  it('emits the complete message when no deltas were streamed', async () => {
    const events = await collect([streamedAssistant]);
    expect(events.map(e => e.type)).toEqual(['thinking_delta', 'assistant', 'tool_use']);
    expect(events[1]).toMatchObject({ content: 'Hello' });
  });

  it('resets dedup state per API call', async () => {
    const second = {
      ...streamedAssistant,
      message: { id: 'msg_2', content: [{ type: 'text', text: 'Second' }] },
    };
    const events = await collect([streamEvent(textDelta('Hello')), streamedAssistant, second]);
    expect(events.map(e => e.type)).toEqual(['assistant_delta', 'tool_use', 'assistant']);
    expect(events[2]).toMatchObject({ content: 'Second' });
  });

  it('does not let sub-agent deltas suppress main-loop text', async () => {
    const events = await collect([streamEvent(textDelta('sub'), 'tool_9'), streamedAssistant]);
    expect(events.map(e => e.type)).toEqual(['thinking_delta', 'assistant', 'tool_use']);
  });
});
