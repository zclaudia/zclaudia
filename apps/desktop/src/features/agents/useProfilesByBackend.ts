import { useMemo } from 'react';
import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import { listAgentProfilesForBackend } from '../../services/api';
import { useCatalogByBackend } from './useCatalogByBackend';
import type { AgentsBackend } from './agents-types';

export type { AgentsBackend } from './agents-types';

export interface ProfilesByBackend {
  profiles: Map<string, AgentProfileConfig[]>;
  errors: Map<string, string>;
  loading: boolean;
}

/** Fetch each online backend's agent profiles; refetches when agentsRefreshNonce bumps. */
export function useProfilesByBackend(backends: AgentsBackend[]): ProfilesByBackend {
  const { data, errors, loading } = useCatalogByBackend(backends, listAgentProfilesForBackend);
  return useMemo(() => ({ profiles: data, errors, loading }), [data, errors, loading]);
}
