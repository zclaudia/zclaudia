import { useMemo } from 'react';
import type { LlmProfileConfig } from '@zclaudia/shared';
import { listLlmProfilesForBackend } from '../../services/api';
import { useCatalogByBackend } from './useCatalogByBackend';
import type { AgentsBackend } from './agents-types';

export type { AgentsBackend } from './agents-types';

export interface LlmProfilesByBackend {
  profiles: Map<string, LlmProfileConfig[]>;
  errors: Map<string, string>;
  loading: boolean;
}

/** Fetch each online backend's LLM profiles; refetches when agentsRefreshNonce bumps. */
export function useLlmProfilesByBackend(backends: AgentsBackend[]): LlmProfilesByBackend {
  const { data, errors, loading } = useCatalogByBackend(backends, listLlmProfilesForBackend);
  return useMemo(() => ({ profiles: data, errors, loading }), [data, errors, loading]);
}
