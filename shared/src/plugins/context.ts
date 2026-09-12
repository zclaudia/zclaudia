import type { CapabilityNegotiationResult } from './capabilities.js';
import type { PluginManifest } from './manifest.js';
import type { ToolRegistration } from './tools.js';
import type { UIExtensionRegistration } from './contributions.js';
import type {
  EventAPI,
  StorageAPI,
  LogAPI,
  FileSystemAPI,
  NetworkAPI,
  NotificationAPI,
  ClipboardAPI,
  ShellAPI,
  SessionAPI,
  ProjectAPI,
  UIAPI,
  ProviderAPI,
  AgentRuntimesAPI,
  McpAPI,
  PluginSchedulerAPI,
} from './runtime-apis.js';
import type { ManagedRuntimesAPI } from './managed-runtimes.js';

export type CommandHandler = (
  args: string[],
  context?: Record<string, unknown>
) => Promise<unknown> | unknown;

export interface PluginContext {
  pluginId: string;

  events: EventAPI;

  commands: {
    registerCommand(command: string, handler: CommandHandler): void;
    unregisterCommand(command: string): void;
  };
  tools: {
    registerTool(meta: ToolRegistration): void;
    unregisterTool(toolId: string): void;
  };
  registerUIExtension(extension: UIExtensionRegistration): void;

  storage: StorageAPI;

  // Core API (permission-gated)
  fs?: FileSystemAPI;
  network?: NetworkAPI;
  notification?: NotificationAPI;
  clipboard?: ClipboardAPI;
  shell?: ShellAPI;
  scheduler?: PluginSchedulerAPI;

  // App API
  session?: SessionAPI;
  project?: ProjectAPI;
  ui?: UIAPI;

  // AI provider API (permission-gated)
  providers?: ProviderAPI;

  // External-agent runtime registration (requires provider.register permission)
  agentRuntimes?: AgentRuntimesAPI;

  // Host-owned Agent CLI resolution. Plugins never download or execute installers.
  managedRuntimes?: ManagedRuntimesAPI;

  // MCP API (requires the network.fetch permission)
  mcp?: McpAPI;

  capabilities?: CapabilityNegotiationResult;

  // Inter-plugin communication
  exports<T>(api: T): void;
  getPluginAPI<T>(pluginId: string): T | undefined;

  log: LogAPI;

  env: {
    isDesktop: boolean;
    isServer: boolean;
    appVersion: string;
    platform: 'darwin' | 'win32' | 'linux';
  };
}

export interface PluginInstance {
  manifest: PluginManifest;
  path: string;
  isActive: boolean;
  module?: unknown;
  error?: string;
  pendingPermissions?: string[];
  capabilities?: CapabilityNegotiationResult;
}

export interface PluginModule {
  activate(context: PluginContext): Promise<void> | void;
  deactivate?(): Promise<void> | void;
}
