import { useMemo } from 'react';
import type { McpServerConfig, McpServerStatus } from '@zclaudia/shared';
import { getMcpServersForBackend, getMcpServerStatusesForBackend } from '../../services/api';
import { useCatalogByBackend } from './useCatalogByBackend';
import type { AgentsBackend } from './agents-types';

export interface McpServersByBackend {
  servers: Map<string, McpServerConfig[]>;
  /** Per backend: statuses keyed by server name. Missing entry = statuses unavailable. */
  statuses: Map<string, Record<string, McpServerStatus>>;
  errors: Map<string, string>;
  loading: boolean;
}

interface McpServersFetchResult {
  servers: McpServerConfig[];
  statuses: Record<string, McpServerStatus> | null;
}

/**
 * Fetch each online backend's MCP server configs + statuses; refetches when
 * agentsRefreshNonce bumps.
 *
 * Unlike useSkillsByBackend, this uses a single useCatalogByBackend instance with a
 * composite fetcher instead of two independent ones: statuses are meaningless without
 * their servers (they decorate a server list, not a standalone dataset), so a servers
 * failure must fail the whole backend, while a statuses failure should soft-fail
 * without polluting the errors map.
 */
export function useMcpServersByBackend(backends: AgentsBackend[]): McpServersByBackend {
  const catalog = useCatalogByBackend<McpServersFetchResult>(backends, async backendId => {
    const [serversResult, statusesResult] = await Promise.allSettled([
      getMcpServersForBackend(backendId),
      getMcpServerStatusesForBackend(backendId),
    ]);

    if (serversResult.status === 'rejected') {
      throw serversResult.reason;
    }

    if (statusesResult.status === 'rejected') {
      return { servers: serversResult.value, statuses: null };
    }

    return {
      servers: serversResult.value,
      statuses: Object.fromEntries(statusesResult.value.map(s => [s.name, s])),
    };
  });

  return useMemo(() => {
    const servers = new Map<string, McpServerConfig[]>();
    const statuses = new Map<string, Record<string, McpServerStatus>>();

    for (const [backendId, result] of catalog.data) {
      servers.set(backendId, result.servers);
      if (result.statuses !== null) {
        statuses.set(backendId, result.statuses);
      }
    }

    return {
      servers,
      statuses,
      errors: catalog.errors,
      loading: catalog.loading,
    };
  }, [catalog]);
}
