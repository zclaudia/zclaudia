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
  idleTimeoutMs?: number;
}

interface SessionBridgeHost {
  promise: Promise<PortableBridgeHost>;
  ready: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

// Longer than Codex's existing 30-minute idle client timeout plus its sweep.
const DEFAULT_IDLE_TIMEOUT_MS = 60 * 60 * 1000;

/**
 * Owns a portable loopback bridge per session. Each endpoint has independent
 * credentials and a catalog bound to that session, including direct HTTP calls.
 *
 * The legacy route-backed bridge remains a compatibility fallback for
 * distributions built before the portable dependency was added.
 */
export class AgentToolBridgeHostManager {
  private readonly getCatalog: () => AgentToolCatalog;
  private readonly loadModule: PortableBridgeModuleLoader;
  private readonly createLegacyEntry: LegacyBridgeFactory;
  private readonly log: Pick<Console, 'warn'>;
  private readonly portableHosts = new Map<string | undefined, SessionBridgeHost>();
  private readonly activeSessions = new Map<string | undefined, number>();
  private readonly closingHosts = new Set<Promise<void>>();
  private readonly idleTimeoutMs: number;
  private closed = false;
  private closePromise?: Promise<void>;
  private portablePackageUnavailable = false;
  private fallbackWarningEmitted = false;

  constructor(options: AgentToolBridgeHostManagerOptions = {}) {
    const configuredCatalog = options.catalog;
    this.getCatalog = configuredCatalog ? () => configuredCatalog : getZClaudiaToolCatalog;
    this.loadModule = options.loadModule ?? loadPortableBridgeModule;
    this.createLegacyEntry = options.createLegacyEntry ?? createLegacyBridgeEntry;
    this.log = options.log ?? console;
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    if (!Number.isFinite(this.idleTimeoutMs) || this.idleTimeoutMs <= 0)
      throw new Error('Tool bridge idle timeout must be positive');
  }

  /** Retain across the complete generator lifetime, including pending approvals. */
  retainSession(sessionId?: string): () => void {
    if (this.closed) throw new Error('Tool bridge manager is closed');
    this.activeSessions.set(sessionId, (this.activeSessions.get(sessionId) ?? 0) + 1);
    const record = this.portableHosts.get(sessionId);
    if (record?.timer) clearTimeout(record.timer);
    let released = false;
    return () => {
      if (released || this.closed) return;
      released = true;
      const count = (this.activeSessions.get(sessionId) ?? 1) - 1;
      if (count > 0) this.activeSessions.set(sessionId, count);
      else {
        this.activeSessions.delete(sessionId);
        const current = this.portableHosts.get(sessionId);
        if (current) this.scheduleEviction(sessionId, current);
      }
    };
  }

  async createEntry(request: ProviderToolBridgeRequest): Promise<ProviderToolBridgeEntry | null> {
    if (this.closed) throw new Error('Tool bridge manager is closed');
    if (this.getCatalog().listTools({ sessionId: request.sessionId }).length === 0) {
      return null;
    }

    if (!this.portablePackageUnavailable) {
      try {
        const host = await this.getPortableHost(request.sessionId);
        if (this.closed) throw new Error('Tool bridge manager is closed');
        return host.createEntry({
          name: DEFAULT_AGENT_PLUGIN_BRIDGE_MCP_SERVER_NAME,
          sessionId: request.sessionId,
        });
      } catch (error) {
        if (!isMissingPortableBridgePackage(error)) throw error;
        this.portablePackageUnavailable = true;
        this.portableHosts.delete(request.sessionId);
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

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    const hosts = [...this.portableHosts.values()];
    this.portableHosts.clear();
    this.activeSessions.clear();
    for (const host of hosts) if (host.timer) clearTimeout(host.timer);
    this.closePromise = Promise.all([
      ...this.closingHosts,
      ...hosts.map(host => this.closeRecord(host)),
    ]).then(() => undefined);
    return this.closePromise;
  }

  private closeRecord(record: SessionBridgeHost): Promise<void> {
    const closing = record.promise.catch(() => undefined).then(host => host?.close());
    this.closingHosts.add(closing);
    void closing.then(
      () => this.closingHosts.delete(closing),
      () => this.closingHosts.delete(closing)
    );
    return closing;
  }

  private scheduleEviction(sessionId: string | undefined, record: SessionBridgeHost): void {
    if (record.timer) clearTimeout(record.timer);
    if (this.closed || !record.ready || this.activeSessions.has(sessionId)) return;
    record.timer = setTimeout(() => {
      if (this.portableHosts.get(sessionId) !== record || this.activeSessions.has(sessionId))
        return;
      this.portableHosts.delete(sessionId);
      void this.closeRecord(record).catch(error =>
        this.log.warn('[AgentToolBridge] Failed to close idle session endpoint:', error)
      );
    }, this.idleTimeoutMs);
    record.timer.unref();
  }

  private getPortableHost(sessionId?: string): Promise<PortableBridgeHost> {
    const existing = this.portableHosts.get(sessionId);
    if (existing) {
      this.scheduleEviction(sessionId, existing);
      return existing.promise;
    }
    const promise = this.loadModule().then(module => {
      const stdioBridgeLaunch = resolveBundledAgentToolBridgeStdioLaunch();
      const assertSession = (requested?: string) => {
        if (requested !== undefined && requested !== sessionId)
          throw new Error('Tool bridge credentials belong to another session');
      };
      const catalog: AgentToolCatalog = {
        listTools: context => {
          assertSession(context.sessionId);
          return this.getCatalog().listTools({ sessionId });
        },
        callTool: (name, args, context) => {
          assertSession(context.sessionId);
          return this.getCatalog().callTool(name, args, { ...context, sessionId });
        },
      };
      return module.createPortableToolBridgeHost({
        catalog,
        requestTimeoutMs: 30_000,
        ...(stdioBridgeLaunch ? { stdioBridgeLaunch } : {}),
      });
    });
    const record: SessionBridgeHost = { promise, ready: false };
    this.portableHosts.set(sessionId, record);
    void promise.then(
      () => {
        record.ready = true;
        if (this.portableHosts.get(sessionId) === record) this.scheduleEviction(sessionId, record);
      },
      () => {
        if (this.portableHosts.get(sessionId) === record) this.portableHosts.delete(sessionId);
        if (record.timer) clearTimeout(record.timer);
      }
    );
    return promise;
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

export function retainAgentToolBridgeSession(sessionId?: string): () => void {
  return agentToolBridgeHostManager.retainSession(sessionId);
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
