/**
 * MCP Server Store - Zustand store for MCP server management UI state
 */

import { create } from 'zustand';
import type { McpServerConfig, McpServerStatus } from '@zclaudia/shared';
import type {
  McpOAuthConfig,
  McpOAuthCredentials,
  McpServerTransport,
  McpServerTrustPolicy,
} from '@zclaudia/shared/core/mcp';
import {
  getMcpServers,
  createMcpServer,
  updateMcpServer,
  deleteMcpServer,
  toggleMcpServer,
  getMcpServerStatuses,
  connectMcpServer,
  disconnectMcpServer,
  refreshMcpServer,
} from '../services/api';

interface McpServerStoreState {
  servers: McpServerConfig[];
  statuses: Record<string, McpServerStatus>;
  isLoading: boolean;
  error: string | null;

  fetchServers: () => Promise<void>;
  fetchStatuses: () => Promise<void>;
  addServer: (config: {
    name: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
    transport?: McpServerTransport;
    url?: string;
    headers?: Record<string, string>;
    headersHelper?: string;
    oauthConfig?: McpOAuthConfig;
    oauthCredentials?: McpOAuthCredentials;
    enabled?: boolean;
    description?: string;
    providerScope?: string[];
    trustPolicy?: McpServerTrustPolicy;
  }) => Promise<McpServerConfig>;
  editServer: (
    id: string,
    config: Partial<{
      name: string;
      command: string;
      args: string[];
      env: Record<string, string>;
      transport: McpServerTransport;
      url: string;
      headers: Record<string, string>;
      headersHelper: string;
      oauthConfig: McpOAuthConfig;
      oauthCredentials: McpOAuthCredentials | null;
      enabled: boolean;
      description: string;
      providerScope: string[];
      trustPolicy: McpServerTrustPolicy;
    }>
  ) => Promise<void>;
  removeServer: (id: string) => Promise<void>;
  toggle: (id: string) => Promise<void>;
  connect: (name: string) => Promise<void>;
  disconnect: (name: string) => Promise<void>;
  refresh: (name: string) => Promise<void>;
}

export const useMcpServerStore = create<McpServerStoreState>((set, get) => ({
  servers: [],
  statuses: {},
  isLoading: false,
  error: null,

  fetchServers: async () => {
    set({ isLoading: true, error: null });
    try {
      const servers = await getMcpServers();
      set({ servers, isLoading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), isLoading: false });
    }
  },

  fetchStatuses: async () => {
    try {
      const statuses = await getMcpServerStatuses();
      set({ statuses: Object.fromEntries(statuses.map(status => [status.name, status])) });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  addServer: async config => {
    const server = await createMcpServer(config);
    set({ servers: [...get().servers, server] });
    return server;
  },

  editServer: async (id, config) => {
    const updated = await updateMcpServer(id, config);
    set({ servers: get().servers.map(s => (s.id === id ? updated : s)) });
  },

  removeServer: async id => {
    await deleteMcpServer(id);
    set({ servers: get().servers.filter(s => s.id !== id) });
  },

  toggle: async id => {
    const updated = await toggleMcpServer(id);
    set({ servers: get().servers.map(s => (s.id === id ? updated : s)) });
  },

  connect: async name => {
    const status = await connectMcpServer(name);
    set({ statuses: { ...get().statuses, [name]: status } });
  },

  disconnect: async name => {
    const status = await disconnectMcpServer(name);
    set({ statuses: { ...get().statuses, [name]: status } });
  },

  refresh: async name => {
    const status = await refreshMcpServer(name);
    set({ statuses: { ...get().statuses, [name]: status } });
  },
}));
