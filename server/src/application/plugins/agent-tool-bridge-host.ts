import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPortableToolBridgeHost } from '@zclaudia/agent-tool-bridge';
import type {
  ProviderToolBridgeEntry,
  ProviderToolBridgeRequest,
} from '@zclaudia/shared/providers';
import {
  createAgentPluginToolBridgeMcpEntry as createLegacyBridgeEntry,
  DEFAULT_AGENT_PLUGIN_BRIDGE_MCP_SERVER_NAME,
} from '../../infra/providers/external-agents/agent-plugin/tool-bridge.js';
import { getZClaudiaToolCatalog, type AgentToolCatalog } from './tool-catalog.js';

const PORTABLE_BRIDGE_PACKAGE = '@zclaudia/agent-tool-bridge';

interface PortableBridgeHost {
  createEntry(options?: { name?: string; sessionId?: string }): ProviderToolBridgeEntry;
  close(): Promise<void>;
}

interface PortableBridgeModule {
  createPortableToolBridgeHost(options: {
    catalog: AgentToolCatalog;
    requestTimeoutMs?: number;
    stdioBridgeLaunch?: {
      command: string;
      args?: string[];
    };
  }): Promise<PortableBridgeHost>;
}

type PortableBridgeModuleLoader = () => Promise<PortableBridgeModule>;
type LegacyBridgeFactory = typeof createLegacyBridgeEntry;

export interface AgentToolBridgeHostManagerOptions {
  catalog?: AgentToolCatalog;
  loadModule?: PortableBridgeModuleLoader;
  createLegacyEntry?: LegacyBridgeFactory;
  log?: Pick<Console, 'warn'>;
}

/**
 * Owns one portable loopback bridge for the server process and creates
 * session-specific MCP entries for external agent plugins.
 *
 * The legacy route-backed bridge remains a compatibility fallback for
 * distributions built before the portable dependency was added.
 */
export class AgentToolBridgeHostManager {
  private readonly getCatalog: () => AgentToolCatalog;
  private readonly loadModule: PortableBridgeModuleLoader;
  private readonly createLegacyEntry: LegacyBridgeFactory;
  private readonly log: Pick<Console, 'warn'>;
  private portableHostPromise?: Promise<PortableBridgeHost>;
  private portablePackageUnavailable = false;
  private fallbackWarningEmitted = false;

  constructor(options: AgentToolBridgeHostManagerOptions = {}) {
    const configuredCatalog = options.catalog;
    this.getCatalog = configuredCatalog ? () => configuredCatalog : getZClaudiaToolCatalog;
    this.loadModule = options.loadModule ?? loadPortableBridgeModule;
    this.createLegacyEntry = options.createLegacyEntry ?? createLegacyBridgeEntry;
    this.log = options.log ?? console;
  }

  async createEntry(request: ProviderToolBridgeRequest): Promise<ProviderToolBridgeEntry | null> {
    if (this.getCatalog().listTools({ sessionId: request.sessionId }).length === 0) {
      return null;
    }

    if (!this.portablePackageUnavailable) {
      try {
        const host = await this.getPortableHost();
        return host.createEntry({
          name: DEFAULT_AGENT_PLUGIN_BRIDGE_MCP_SERVER_NAME,
          sessionId: request.sessionId,
        });
      } catch (error) {
        if (!isMissingPortableBridgePackage(error)) throw error;
        this.portablePackageUnavailable = true;
        this.portableHostPromise = undefined;
        if (!this.fallbackWarningEmitted) {
          this.fallbackWarningEmitted = true;
          this.log.warn(
            `[AgentToolBridge] ${PORTABLE_BRIDGE_PACKAGE} is not installed; using the legacy local bridge.`
          );
        }
      }
    }

    const config = await this.createLegacyEntry({
      serverPort: request.serverPort,
      zclaudiaSessionId: request.sessionId,
    });
    return config
      ? {
          name: DEFAULT_AGENT_PLUGIN_BRIDGE_MCP_SERVER_NAME,
          config,
        }
      : null;
  }

  async close(): Promise<void> {
    const hostPromise = this.portableHostPromise;
    this.portableHostPromise = undefined;
    if (!hostPromise) return;
    const host = await hostPromise.catch(() => undefined);
    await host?.close();
  }

  private getPortableHost(): Promise<PortableBridgeHost> {
    this.portableHostPromise ??= this.loadModule().then(module => {
      const stdioBridgeLaunch = resolveBundledAgentToolBridgeStdioLaunch();
      return module.createPortableToolBridgeHost({
        catalog: this.getCatalog(),
        requestTimeoutMs: 30_000,
        ...(stdioBridgeLaunch ? { stdioBridgeLaunch } : {}),
      });
    });
    return this.portableHostPromise;
  }
}

const agentToolBridgeHostManager = new AgentToolBridgeHostManager();

export function createAgentToolBridgeEntry(
  request: ProviderToolBridgeRequest
): Promise<ProviderToolBridgeEntry | null> {
  return agentToolBridgeHostManager.createEntry(request);
}

export function closeAgentToolBridgeHost(): Promise<void> {
  return agentToolBridgeHostManager.close();
}

async function loadPortableBridgeModule(): Promise<PortableBridgeModule> {
  return { createPortableToolBridgeHost };
}

function isMissingPortableBridgePackage(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as NodeJS.ErrnoException).code;
  const message = error instanceof Error ? error.message : String(error);
  return code === 'ERR_MODULE_NOT_FOUND' && message.includes(PORTABLE_BRIDGE_PACKAGE);
}

export function resolveBundledAgentToolBridgeStdioLaunch(
  currentModuleUrl: string = import.meta.url,
  pathExists: (candidate: string) => boolean = existsSync
): { command: string; args: string[] } | undefined {
  const currentDirectory = path.dirname(fileURLToPath(currentModuleUrl));
  const candidates = [
    // Normal server dist layout.
    path.join(currentDirectory, 'agent-tool-bridge-stdio.js'),
    // Single-file server bundle layout.
    path.join(currentDirectory, 'application', 'plugins', 'agent-tool-bridge-stdio.js'),
  ];
  const bridgePath = candidates.find(pathExists);
  return bridgePath ? { command: process.execPath, args: [bridgePath] } : undefined;
}
