import { describe, expect, it } from 'vitest';
import { buildAgentCancelMessage, buildClaudiaMessage } from '../claudiaProtocol';

describe('buildClaudiaMessage', () => {
  const base = {
    clientRequestId: 'req-1',
    content: 'hello',
    projectId: 'p',
    resumeCurrent: false,
    targetThreadId: 'thread-1',
    forceNew: false,
  };

  it('sends plain text input and reuses the active thread', () => {
    expect(buildClaudiaMessage(base)).toEqual({
      type: 'claudia_message',
      clientRequestId: 'req-1',
      input: 'hello',
      projectId: 'p',
      activeBranchId: 'thread-1',
    });
  });

  it('wraps attachments into the JSON input envelope', () => {
    const message = buildClaudiaMessage({
      ...base,
      content: 'with file',
      attachments: [
        { id: 'a1', type: 'file', name: 'notes.txt', data: 'Zm9v', mimeType: 'text/plain' },
      ],
    });
    expect(message.input).toBe(
      JSON.stringify({
        text: 'with file',
        attachments: [
          { id: 'a1', type: 'file', name: 'notes.txt', data: 'Zm9v', mimeType: 'text/plain' },
        ],
      })
    );
  });

  it('carries the explicit profile only when not resuming the current thread', () => {
    expect(
      buildClaudiaMessage({ ...base, explicitProfileId: 'agent-1' }).agentProfileId
    ).toBe('agent-1');
    const resumed = buildClaudiaMessage({ ...base, explicitProfileId: 'agent-1', resumeCurrent: true });
    expect(resumed.agentProfileId).toBeUndefined();
    expect(resumed.activeBranchId).toBe('thread-1');
  });

  it('forces a new branch without an activeBranchId', () => {
    const forced = buildClaudiaMessage({ ...base, forceNew: true });
    expect(forced.forceNewBranch).toBe(true);
    expect(forced.activeBranchId).toBeUndefined();
  });

  it('keeps a missing explicit target instead of inventing one', () => {
    const message = buildClaudiaMessage({ ...base, targetThreadId: null });
    expect(message.activeBranchId).toBeUndefined();
    expect(message.forceNewBranch).toBeUndefined();
  });
});

describe('buildAgentCancelMessage', () => {
  it('includes runId only when known', () => {
    expect(buildAgentCancelMessage('session-1', 'run-9')).toEqual({
      type: 'agent_cancel',
      sessionId: 'session-1',
      runId: 'run-9',
    });
    expect(buildAgentCancelMessage('session-1')).toEqual({
      type: 'agent_cancel',
      sessionId: 'session-1',
    });
  });
});
