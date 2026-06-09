import type {
  McpPromptDefinition,
  McpResourceDefinition,
  McpToolDefinition,
} from './mcp-client.js';
import type { McpServerInventorySummary } from '@zclaudia/shared/core/mcp';
import type { McpServerRuntimeConfig } from './mcp-config.js';

export interface McpInventory {
  server: string;
  configHash: string;
  tools: McpToolDefinition[];
  resources: McpResourceDefinition[];
  prompts: McpPromptDefinition[];
  cachedAt: number;
  summary: McpServerInventorySummary;
}

interface McpInventoryLoaders {
  listTools?: () => Promise<McpToolDefinition[]>;
  listResources?: () => Promise<McpResourceDefinition[]>;
  listPrompts?: () => Promise<McpPromptDefinition[]>;
}

interface CacheEntry {
  inventory: McpInventory;
}

export class McpInventoryCache {
  private entries = new Map<string, CacheEntry>();

  constructor(
    private readonly options: {
      ttlMs?: number;
      now?: () => number;
    } = {},
  ) {}

  configHash(config: McpServerRuntimeConfig): string {
    return JSON.stringify({
      transport: config.transport ?? 'stdio',
      command: config.command,
      args: 'args' in config ? config.args ?? [] : [],
      env: Object.entries('env' in config ? config.env ?? {} : {}).sort(([a], [b]) => a.localeCompare(b)),
      url: 'url' in config ? config.url : undefined,
      headers: Object.entries('headers' in config ? config.headers ?? {} : {}).sort(([a], [b]) => a.localeCompare(b)),
      oauthConfig: 'oauthConfig' in config ? config.oauthConfig : undefined,
      oauthCredentials: 'oauthCredentials' in config ? config.oauthCredentials : undefined,
    });
  }

  async getInventory(
    server: string,
    config: McpServerRuntimeConfig,
    loaders: McpInventoryLoaders,
  ): Promise<McpInventory> {
    const configHash = this.configHash(config);
    const key = this.key(server, configHash);
    const now = this.now();
    const cached = this.entries.get(key);
    if (cached && now - cached.inventory.cachedAt <= this.ttlMs()) {
      return cached.inventory;
    }

    const [tools, resources, prompts] = await Promise.all([
      loaders.listTools?.() ?? Promise.resolve([]),
      loaders.listResources?.().catch(() => []) ?? Promise.resolve([]),
      loaders.listPrompts?.().catch(() => []) ?? Promise.resolve([]),
    ]);
    const inventory: McpInventory = {
      server,
      configHash,
      tools,
      resources,
      prompts,
      cachedAt: now,
      summary: {
        tools: tools.length,
        resources: resources.length,
        prompts: prompts.length,
        cachedAt: now,
      },
    };
    this.entries.set(key, { inventory });
    return inventory;
  }

  getCached(server: string, configHash: string): McpInventory | undefined {
    return this.entries.get(this.key(server, configHash))?.inventory;
  }

  invalidate(server?: string): void {
    if (!server) {
      this.entries.clear();
      return;
    }
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(`${server}:`)) this.entries.delete(key);
    }
  }

  private key(server: string, configHash: string): string {
    return `${server}:${configHash}`;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private ttlMs(): number {
    return this.options.ttlMs ?? 60_000;
  }
}

export const mcpInventoryCache = new McpInventoryCache();
