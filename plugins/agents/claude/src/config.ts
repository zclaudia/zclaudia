import { existsSync, readFileSync } from 'fs';
import { agentConfigDirectory } from '@zclaudia/agent-common';
import path from 'path';
import type { McpServerConfig, SdkPluginConfig } from '@anthropic-ai/claude-agent-sdk';

interface McpConfigFile {
  mcpServers?: Record<string, Partial<McpServerConfig> & { command?: string }>;
}

interface SettingsFile {
  enabledPlugins?: Record<string, boolean>;
}

interface InstalledPluginsFile {
  version: number;
  plugins: Record<
    string,
    Array<{
      scope: string;
      installPath: string;
      version: string;
    }>
  >;
}

export interface ClaudeAgentConfig {
  mcpServers: Record<string, McpServerConfig>;
  plugins: SdkPluginConfig[];
}

const CACHE_TTL_MS = 10 * 60 * 1000;

// The cache is keyed by the discovery source directory. SDK-mode runs resolve
// their state under a session-scoped CLAUDE_CONFIG_DIR while discovery always
// reads the real user directory — a single-slot cache could serve one
// backend's/test's directory contents to another after ZCLAUDIA_AGENT_CONFIG_ROOT
// changes between runs.
interface ConfigCacheEntry {
  config: ClaudeAgentConfig;
  cachedAt: number;
}
const configCache = new Map<string, ConfigCacheEntry>();

export function clearClaudeAgentConfigCache(): void {
  configCache.clear();
}

function claudeHome(): string {
  return agentConfigDirectory('claude');
}

function readJson<T>(filePath: string): T | null {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function loadMcpServers(): Record<string, McpServerConfig> {
  const parsed = readJson<McpConfigFile>(path.join(claudeHome(), 'mcp.json'));
  const servers: Record<string, McpServerConfig> = {};

  for (const [name, server] of Object.entries(parsed?.mcpServers ?? {})) {
    if (!server.command || typeof server.command !== 'string') continue;
    servers[name] = {
      ...server,
      command: server.command,
    } as McpServerConfig;
  }

  return servers;
}

function loadPlugins(): SdkPluginConfig[] {
  const settings = readJson<SettingsFile>(path.join(claudeHome(), 'settings.json'));
  const installed = readJson<InstalledPluginsFile>(
    path.join(claudeHome(), 'plugins', 'installed_plugins.json')
  );
  const enabledPlugins = settings?.enabledPlugins ?? {};
  const registry = installed?.plugins ?? {};
  const plugins: SdkPluginConfig[] = [];

  for (const [pluginKey, enabled] of Object.entries(enabledPlugins)) {
    if (!enabled) continue;
    const install = registry[pluginKey]?.[0];
    if (!install?.installPath || !existsSync(install.installPath)) continue;
    plugins.push({ type: 'local', path: install.installPath });
  }

  return plugins;
}

export function loadClaudeAgentConfig(): ClaudeAgentConfig {
  const sourceDir = claudeHome();
  const cached = configCache.get(sourceDir);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.config;
  }

  const config: ClaudeAgentConfig = {
    mcpServers: loadMcpServers(),
    plugins: loadPlugins(),
  };
  configCache.set(sourceDir, { config, cachedAt: Date.now() });
  return config;
}
