import { describe, expect, it, vi } from 'vitest';
import { AcpPermissionBridge } from '../acp-permissions.js';

const REQUEST = {
  sessionId: 's1',
  toolCall: {
    toolCallId: 't1',
    kind: 'execute' as const,
    title: 'Bash',
    status: 'in_progress' as const,
    rawInput: { command: 'echo hi' },
    content: [
      {
        type: 'content' as const,
        content: { type: 'text' as const, text: 'Not in allowlist: echo' },
      },
    ],
  },
  options: [
    { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' as const },
    { optionId: 'allow-always', name: 'Always allow', kind: 'allow_always' as const },
    { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' as const },
  ],
};
const SIGNAL = new AbortController().signal;

describe('AcpPermissionBridge', () => {
  it('maps host approval to allow_once only — never allow_always (§8.2)', async () => {
    const onPermission = vi.fn().mockResolvedValue({ behavior: 'allow' });
    const bridge = new AcpPermissionBridge({ supervised: true, onPermission });
    const response = await bridge.handleRequest(REQUEST as never, SIGNAL);
    expect(response.outcome).toEqual({ outcome: 'selected', optionId: 'allow-once' });
    expect(bridge.decisionFor('t1')).toBe('allowed');
  });

  it('maps host denial to reject_once (§8.2)', async () => {
    const bridge = new AcpPermissionBridge({
      supervised: true,
      onPermission: async () => ({ behavior: 'deny' }),
    });
    const response = await bridge.handleRequest(REQUEST as never, SIGNAL);
    expect(response.outcome).toEqual({ outcome: 'selected', optionId: 'reject-once' });
    expect(bridge.decisionFor('t1')).toBe('denied');
  });

  it('bypass mode auto-selects allow_once without calling the host callback (§8.2)', async () => {
    const onPermission = vi.fn();
    const bridge = new AcpPermissionBridge({ supervised: false, onPermission });
    const response = await bridge.handleRequest(REQUEST as never, SIGNAL);
    expect(response.outcome).toEqual({ outcome: 'selected', optionId: 'allow-once' });
    expect(onPermission).not.toHaveBeenCalled();
  });

  it('denies when the callback throws — fail closed (§8.2)', async () => {
    const onPermission = vi.fn().mockRejectedValue(new Error('UI gone'));
    const bridge = new AcpPermissionBridge({ supervised: true, onPermission });
    const response = await bridge.handleRequest(REQUEST as never, SIGNAL);
    expect(response.outcome).toEqual({ outcome: 'selected', optionId: 'reject-once' });
    expect(bridge.decisionFor('t1')).toBe('denied');
  });

  it('denies when no callback is registered — fail closed', async () => {
    const bridge = new AcpPermissionBridge({ supervised: true, onPermission: undefined });
    const response = await bridge.handleRequest(REQUEST as never, SIGNAL);
    expect(response.outcome).toEqual({ outcome: 'selected', optionId: 'reject-once' });
    expect(bridge.decisionFor('t1')).toBe('denied');
  });

  it('cancels (deny) when the run aborts while waiting on the callback', async () => {
    let release: (value: { behavior: 'allow' }) => void = () => {};
    const bridge = new AcpPermissionBridge({
      supervised: true,
      onPermission: () => new Promise(resolve => (release = resolve)),
    });
    const controller = new AbortController();
    const pending = bridge.handleRequest(REQUEST as never, controller.signal);
    controller.abort();
    const response = await pending;
    expect(response.outcome).toEqual({ outcome: 'selected', optionId: 'reject-once' });
    release({ behavior: 'allow' }); // Late allow must not flip the decision.
    expect(bridge.decisionFor('t1')).toBe('cancelled');
  });

  it('denies when the host returns modified input — ACP cannot apply it (§8.2)', async () => {
    const bridge = new AcpPermissionBridge({
      supervised: true,
      onPermission: async () => ({ behavior: 'allow', updatedInput: { command: 'echo hacked' } }),
    });
    const response = await bridge.handleRequest(REQUEST as never, SIGNAL);
    expect(response.outcome).toEqual({ outcome: 'selected', optionId: 'reject-once' });
    expect(bridge.decisionFor('t1')).toBe('denied');
  });

  it('accepts an unchanged updatedInput echoed by host auto-approval', async () => {
    const bridge = new AcpPermissionBridge({
      supervised: true,
      onPermission: async request => ({ behavior: 'allow', updatedInput: request.toolInput }),
    });
    const response = await bridge.handleRequest(REQUEST as never, SIGNAL);
    expect(response.outcome).toEqual({ outcome: 'selected', optionId: 'allow-once' });
    expect(bridge.decisionFor('t1')).toBe('allowed');
  });

  it('records a denial when allow_once is absent instead of reporting a false local allow', async () => {
    const bridge = new AcpPermissionBridge({
      supervised: true,
      onPermission: async () => ({ behavior: 'allow' }),
    });
    const noOneShotAllow = {
      ...REQUEST,
      options: [
        { optionId: 'allow-always', name: 'Always', kind: 'allow_always' as const },
        { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' as const },
      ],
    };
    const response = await bridge.handleRequest(noOneShotAllow as never, SIGNAL);
    expect(response.outcome).toEqual({ outcome: 'selected', optionId: 'reject-once' });
    expect(bridge.decisionFor('t1')).toBe('denied');
  });

  it('enforces the permission callback timeout and fails closed', async () => {
    const bridge = new AcpPermissionBridge({
      supervised: true,
      onPermission: () => new Promise(() => {}),
      timeoutMs: 5,
    });
    const response = await bridge.handleRequest(REQUEST as never, SIGNAL);
    expect(response.outcome).toEqual({ outcome: 'selected', optionId: 'reject-once' });
    expect(bridge.decisionFor('t1')).toBe('denied');
  });

  it('matches options by kind and tolerates reordering and extra options (§2.6)', async () => {
    const bridge = new AcpPermissionBridge({
      supervised: true,
      onPermission: async () => ({ behavior: 'deny' }),
    });
    const shuffled = {
      ...REQUEST,
      options: [
        { optionId: 'x', name: 'X', kind: 'allow_always' as const },
        { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' as const },
        { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' as const },
      ],
    };
    const response = await bridge.handleRequest(shuffled as never, SIGNAL);
    expect(response.outcome).toEqual({ outcome: 'selected', optionId: 'reject-once' });
  });

  it('cancels when no deny-shaped option exists instead of allowing (§8.2)', async () => {
    const bridge = new AcpPermissionBridge({
      supervised: true,
      onPermission: async () => ({ behavior: 'deny' }),
    });
    const noDeny = {
      ...REQUEST,
      options: [
        { optionId: 'allow-once', name: 'Allow', kind: 'allow_once' as const },
        { optionId: 'allow-always', name: 'Always', kind: 'allow_always' as const },
      ],
    };
    const response = await bridge.handleRequest(noDeny as never, SIGNAL);
    expect(response.outcome).toEqual({ outcome: 'cancelled' });
  });

  it('builds the host permission request with bounded input and reason detail', async () => {
    const onPermission = vi.fn().mockResolvedValue({ behavior: 'deny' });
    const bridge = new AcpPermissionBridge({ supervised: true, onPermission });
    await bridge.handleRequest(REQUEST as never, SIGNAL);
    const request = onPermission.mock.calls[0][0];
    expect(request.toolName).toBe('Bash');
    expect(request.toolInput).toEqual({ command: 'echo hi' });
    expect(request.detail).toContain('Not in allowlist: echo');
    expect(request.timeoutBehavior).toBe('deny');
  });
});
