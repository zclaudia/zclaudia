import { useMemo } from 'react';
import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import type {
  ClaudiaRunInstance,
  ClaudiaThreadSummary,
} from '../../stores/claudiaStore';

export type ProfileSourceLabel =
  | 'Explicit selection'
  | 'Project default'
  | 'Global default'
  | 'Session bound';

function sourceLabel(source: string | undefined, explicit: boolean): ProfileSourceLabel {
  if (explicit) return 'Explicit selection';
  switch (source) {
    case 'project-default':
      return 'Project default';
    case 'session-bound':
      return 'Session bound';
    case 'explicit':
      return 'Explicit selection';
    default:
      return 'Global default';
  }
}

/**
 * Profile binding priority state machine: which agent profile backs the next
 * message. Precedence (top wins): a running run's receipt unless a new topic
 * is armed → the thread's bound session profile unless a new topic is armed →
 * the explicit picker selection → the project default → the global default.
 */
export function useClaudiaProfileBinding({
  threadRuns,
  currentThread,
  threadSessionId,
  explicitProfileId,
  profiles,
  project,
  newTopicArmed,
}: {
  threadRuns: ClaudiaRunInstance[];
  currentThread: ClaudiaThreadSummary | null;
  threadSessionId: string | null;
  explicitProfileId: string;
  profiles: AgentProfileConfig[];
  project: { defaultAgentProfileId?: string | null } | null;
  newTopicArmed: boolean;
}) {
  const boundProfile = useMemo(() => {
    const fromReceipt = [...threadRuns]
      .reverse()
      .find(run => run.status === 'running' && run.agentProfileId);
    if (!newTopicArmed && fromReceipt?.agentProfileId) {
      return {
        id: fromReceipt.agentProfileId,
        sourceLabel: sourceLabel(fromReceipt.agentProfileSource, false),
      };
    }
    if (!newTopicArmed && threadSessionId && currentThread?.session?.agentProfileId) {
      return {
        id: currentThread.session.agentProfileId,
        sourceLabel: 'Session bound' as ProfileSourceLabel,
      };
    }
    const explicit = explicitProfileId ? profiles.find(p => p.id === explicitProfileId) : null;
    if (explicit)
      return { id: explicit.id, sourceLabel: 'Explicit selection' as ProfileSourceLabel };
    if (project?.defaultAgentProfileId) {
      return {
        id: project.defaultAgentProfileId,
        sourceLabel: 'Project default' as ProfileSourceLabel,
      };
    }
    const globalDefault = profiles.find(p => p.isDefault);
    if (globalDefault)
      return { id: globalDefault.id, sourceLabel: 'Global default' as ProfileSourceLabel };
    return null;
  }, [
    threadRuns,
    currentThread,
    threadSessionId,
    explicitProfileId,
    profiles,
    project,
    newTopicArmed,
  ]);
  const boundProfileName =
    profiles.find(p => p.id === boundProfile?.id)?.name ?? boundProfile?.id ?? null;

  return { boundProfile, boundProfileName };
}
