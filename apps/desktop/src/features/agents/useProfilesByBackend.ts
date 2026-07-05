import { useEffect, useState } from 'react';
import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import { listAgentProfilesForBackend } from '../../services/api';
import { useTopLevelViewStore } from '../../stores/topLevelViewStore';

export interface AgentsBackend {
  backendId: string;
  name: string;
  online: boolean;
}

export interface ProfilesByBackend {
  profiles: Map<string, AgentProfileConfig[]>;
  errors: Map<string, string>;
  loading: boolean;
}

/** Fetch each online backend's agent profiles; refetches when agentsRefreshNonce bumps. */
export function useProfilesByBackend(backends: AgentsBackend[]): ProfilesByBackend {
  const nonce = useTopLevelViewStore(s => s.agentsRefreshNonce);
  const [state, setState] = useState<ProfilesByBackend>({
    profiles: new Map(),
    errors: new Map(),
    loading: true,
  });

  const onlineKey = backends.map(b => `${b.backendId}:${b.online}`).join(',');

  useEffect(() => {
    let cancelled = false;
    const onlineBackends = backends.filter(b => b.online);

    setState(prev => ({ ...prev, loading: true }));

    void Promise.allSettled(onlineBackends.map(b => listAgentProfilesForBackend(b.backendId))).then(
      results => {
        if (cancelled) return;

        const profiles = new Map<string, AgentProfileConfig[]>();
        const errors = new Map<string, string>();

        results.forEach((result, index) => {
          const backendId = onlineBackends[index].backendId;
          if (result.status === 'fulfilled') {
            profiles.set(backendId, result.value);
          } else {
            const error = result.reason;
            errors.set(backendId, error instanceof Error ? error.message : String(error));
          }
        });

        setState({ profiles, errors, loading: false });
      }
    );

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlineKey, nonce]);

  return state;
}
