import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useClaudiaProfileBinding } from '../useClaudiaProfileBinding';
import type { ClaudiaRunInstance, ClaudiaThreadSummary } from '../../../stores/claudiaStore';

const thread: ClaudiaThreadSummary = {
  id: 'thread',
  projectId: 'p',
  title: null,
  createdAt: 1,
  updatedAt: 1,
  lastTaskId: null,
  session: {
    id: 'session',
    name: null,
    agentProfileId: 'session-agent',
    lastRunStatus: null,
    updatedAt: 1,
  },
};

const runningRun = {
  clientRequestId: 'req',
  input: 'hi',
  projectId: 'p',
  threadId: 'thread',
  status: 'running',
  agentProfileId: 'receipt-agent',
  agentProfileSource: 'project-default',
  createdAt: 1,
  updatedAt: 1,
} as ClaudiaRunInstance;

const base = {
  currentThread: thread,
  threadSessionId: 'session',
  explicitProfileId: '',
  profiles: [{ id: 'global-agent', name: 'Global', status: 'active', isDefault: true }],
  project: { defaultAgentProfileId: 'project-agent' },
} as const;

describe('useClaudiaProfileBinding priority chain', () => {
  it('binds the running run receipt first', () => {
    const { result } = renderHook(() =>
      useClaudiaProfileBinding({ ...base, threadRuns: [runningRun], newTopicArmed: false })
    );
    expect(result.current.boundProfile).toEqual({
      id: 'receipt-agent',
      sourceLabel: 'Project default',
    });
    expect(result.current.boundProfileName).toBe('receipt-agent');
  });

  it('falls through to the session-bound profile', () => {
    const { result } = renderHook(() =>
      useClaudiaProfileBinding({ ...base, threadRuns: [], newTopicArmed: false })
    );
    expect(result.current.boundProfile).toEqual({ id: 'session-agent', sourceLabel: 'Session bound' });
  });

  it('prefers the explicit selection once armed state allows it', () => {
    const { result } = renderHook(() =>
      useClaudiaProfileBinding({
        ...base,
        profiles: [
          ...base.profiles,
          { id: 'explicit-agent', name: 'Explicit', status: 'active', isDefault: false },
        ],
        threadRuns: [runningRun],
        explicitProfileId: 'explicit-agent',
        newTopicArmed: true,
      })
    );
    expect(result.current.boundProfile).toEqual({
      id: 'explicit-agent',
      sourceLabel: 'Explicit selection',
    });
  });

  it('skips the session binding while a new topic is armed, then project default', () => {
    const { result } = renderHook(() =>
      useClaudiaProfileBinding({
        ...base,
        threadRuns: [],
        explicitProfileId: '',
        newTopicArmed: true,
      })
    );
    expect(result.current.boundProfile).toEqual({
      id: 'project-agent',
      sourceLabel: 'Project default',
    });
  });

  it('ends at the global default when nothing else applies', () => {
    const { result } = renderHook(() =>
      useClaudiaProfileBinding({
        ...base,
        currentThread: { ...thread, session: null },
        threadSessionId: null,
        project: null,
        threadRuns: [],
        newTopicArmed: false,
      })
    );
    expect(result.current.boundProfile).toEqual({
      id: 'global-agent',
      sourceLabel: 'Global default',
    });
    expect(result.current.boundProfileName).toBe('Global');
  });

  it('returns null when no source applies', () => {
    const { result } = renderHook(() =>
      useClaudiaProfileBinding({
        ...base,
        currentThread: { ...thread, session: null },
        threadSessionId: null,
        project: null,
        profiles: [],
        threadRuns: [],
        newTopicArmed: false,
      })
    );
    expect(result.current.boundProfile).toBeNull();
    expect(result.current.boundProfileName).toBeNull();
  });
});
