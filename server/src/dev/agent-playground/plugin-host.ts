import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  Permission,
  PluginContext,
  PluginManifest,
  PluginModule,
} from '@zclaudia/shared/plugin-types';
import type {
  AgentRuntimeDescriptor,
  ExternalAgentAdapter,
  ProviderToolBridgeEntry,
} from '@zclaudia/shared/providers';
import type {
  AgentPlaygroundLogLevel,
  AgentPlaygroundPluginInfo,
} from '@zclaudia/shared/plugins/agent-playground';

interface PlaygroundPluginModule extends PluginModule {
  activate(context: PluginContext & Record<string, unknown>): Promise<void> | void;
}

export interface PlaygroundPluginHostOptions {
  pluginPath: string;
  runtime?: string;
  appVersion: string;
  emitLog: (level: AgentPlaygroundLogLevel, message: string) => void;
}

type ValidatedPluginManifest = PluginManifest & {
  id: string;
  name: string;
  version: string;
  main: string;
  contributes: NonNullable<PluginManifest['contributes']> & {
    agentRuntimes: AgentRuntimeDescriptor[];
  };
};

function stringifyLogValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function assertInsidePlugin(pluginPath: string, candidate: string): void {
  const relative = path.relative(pluginPath, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Plugin main entry escapes the plugin directory: ${candidate}`);
  }
}

function validateManifest(value: unknown, manifestPath: string): ValidatedPluginManifest {
  if (!value || typeof value !== 'object') {
    throw new Error(`Invalid plugin manifest: ${manifestPath}`);
  }
  const manifest = value as PluginManifest;
  if (!manifest.id || !manifest.name || !manifest.version || !manifest.main) {
    throw new Error(`Plugin manifest must declare id, name, version, and main: ${manifestPath}`);
  }
  if (!manifest.contributes?.agentRuntimes?.length) {
    throw new Error(`Plugin does not contribute an agent runtime: ${manifestPath}`);
  }
  return manifest as ValidatedPluginManifest;
}

export class PlaygroundPluginHost {
  private manifest: PluginManifest | null = null;
  private descriptor: AgentRuntimeDescriptor | null = null;
  private adapter: ExternalAgentAdapter | null = null;
  private module: PlaygroundPluginModule | null = null;
  private readonly storage = new Map<string, unknown>();
  private readonly eventHandlers = new Map<string, Set<(data: unknown) => void | Promise<void>>>();
  private exportedApi: unknown;
  private loadRoot: string | null = null;

  constructor(private readonly options: PlaygroundPluginHostOptions) {}

  get pluginPath(): string {
    return path.resolve(this.options.pluginPath);
  }

  get runtime(): AgentRuntimeDescriptor {
    if (!this.descriptor) throw new Error('Playground plugin is not loaded');
    return this.descriptor;
  }

  get runtimeAdapter(): ExternalAgentAdapter {
    if (!this.adapter) throw new Error('Playground plugin did not register its runtime adapter');
    return this.adapter;
  }

  get pluginInfo(): AgentPlaygroundPluginInfo {
    if (!this.manifest) throw new Error('Playground plugin is not loaded');
    return {
      id: this.manifest.id,
      name: this.manifest.name,
      version: this.manifest.version,
      path: this.pluginPath,
    };
  }

  async load(): Promise<void> {
    const manifestPath = path.join(this.pluginPath, 'plugin.json');
    const manifest = validateManifest(
      JSON.parse(await readFile(manifestPath, 'utf8')) as unknown,
      manifestPath
    );
    const requestedRuntime = this.options.runtime;
    const descriptor = requestedRuntime
      ? manifest.contributes?.agentRuntimes?.find(item => item.type === requestedRuntime)
      : manifest.contributes?.agentRuntimes?.[0];
    if (!descriptor) {
      const available = (manifest.contributes?.agentRuntimes ?? [])
        .map(item => item.type)
        .join(', ');
      throw new Error(
        `Runtime "${requestedRuntime}" is not contributed by ${manifest.id}. Available: ${available || 'none'}`
      );
    }

    const sourceModulePath = path.resolve(this.pluginPath, manifest.main);
    assertInsidePlugin(this.pluginPath, sourceModulePath);
    const loadRoot = await this.createLoadSnapshot();
    const modulePath = path.resolve(loadRoot, manifest.main);
    assertInsidePlugin(loadRoot, modulePath);
    const moduleUrl = pathToFileURL(modulePath);

    this.manifest = manifest;
    this.descriptor = descriptor;
    this.adapter = null;
    this.loadRoot = loadRoot;
    try {
      this.module = (await import(moduleUrl.href)) as PlaygroundPluginModule;
      if (typeof this.module.activate !== 'function') {
        throw new Error(`Plugin main module does not export activate(): ${modulePath}`);
      }

      await this.module.activate(this.createContext());
      if (!this.adapter) {
        throw new Error(
          `Plugin ${manifest.id} activated without registering runtime "${descriptor.type}"`
        );
      }
    } catch (error) {
      await this.deactivate().catch(() => {});
      throw error;
    }
    this.options.emitLog(
      'info',
      `Loaded ${manifest.name} ${manifest.version} runtime ${descriptor.type}`
    );
  }

  async reload(): Promise<void> {
    await this.deactivate();
    await this.load();
  }

  async deactivate(): Promise<void> {
    try {
      if (this.module?.deactivate) {
        await this.module.deactivate();
      }
    } finally {
      this.adapter = null;
      this.module = null;
      this.eventHandlers.clear();
      this.exportedApi = undefined;
      if (this.loadRoot) {
        await rm(this.loadRoot, { recursive: true, force: true });
        this.loadRoot = null;
      }
      this.options.emitLog('info', 'Plugin deactivated');
    }
  }

  /**
   * Node's ESM cache also covers modules imported by the plugin entrypoint.
   * Loading a fresh filesystem snapshot gives every transitive module a new URL,
   * so rebuilding adapter.js and reloading really uses the new implementation.
   */
  private async createLoadSnapshot(): Promise<string> {
    const loadRoot = await mkdtemp(path.join(os.tmpdir(), 'zclaudia-agent-playground-'));
    try {
      await cp(this.pluginPath, loadRoot, {
        recursive: true,
        filter: source => {
          const relative = path.relative(this.pluginPath, source);
          return relative !== 'node_modules' && !relative.startsWith(`node_modules${path.sep}`);
        },
      });

      const pluginNodeModules = path.join(this.pluginPath, 'node_modules');
      if (existsSync(pluginNodeModules)) {
        await symlink(pluginNodeModules, path.join(loadRoot, 'node_modules'), 'junction');
      }
      return loadRoot;
    } catch (error) {
      await rm(loadRoot, { recursive: true, force: true });
      throw error;
    }
  }

  private createContext(): PluginContext & Record<string, unknown> {
    const manifest = this.manifest;
    const descriptor = this.descriptor;
    if (!manifest || !descriptor) {
      throw new Error('Cannot create a Playground plugin context before loading the manifest');
    }
    const log = (level: AgentPlaygroundLogLevel, values: unknown[]) =>
      this.options.emitLog(level, values.map(stringifyLogValue).join(' '));

    return {
      pluginId: manifest.id,
      version: manifest.version,
      extensionPath: this.pluginPath,
      events: {
        on: (event, handler) => {
          const handlers = this.eventHandlers.get(event) ?? new Set();
          handlers.add(handler);
          this.eventHandlers.set(event, handlers);
          return () => handlers.delete(handler);
        },
        once: (event, handler) => {
          const wrapped = async (data: unknown) => {
            this.eventHandlers.get(event)?.delete(wrapped);
            await handler(data);
          };
          const handlers = this.eventHandlers.get(event) ?? new Set();
          handlers.add(wrapped);
          this.eventHandlers.set(event, handlers);
        },
        off: (event, handler) => {
          this.eventHandlers.get(event)?.delete(handler);
        },
        emit: async (event, data) => {
          for (const handler of this.eventHandlers.get(event) ?? []) await handler(data);
        },
      },
      commands: {
        registerCommand: command =>
          this.options.emitLog('debug', `Ignored command registration in Playground: ${command}`),
        unregisterCommand: () => {},
      },
      tools: {
        registerTool: tool =>
          this.options.emitLog(
            'debug',
            `Ignored plugin tool registration in Playground: ${tool.id}`
          ),
        unregisterTool: () => {},
      },
      registerUIExtension: extension =>
        this.options.emitLog(
          'debug',
          `Ignored UI extension registration in Playground: ${extension.id}`
        ),
      workflowSteps: {
        registerWorkflowStep: (stepId: string) =>
          this.options.emitLog(
            'debug',
            `Ignored workflow step registration in Playground: ${stepId}`
          ),
        unregisterWorkflowStep: () => {},
      },
      permissions: {
        hasPermission: (permission: Permission) =>
          manifest.permissions?.includes(permission) ?? false,
        hasAllPermissions: (permissions: Permission[]) =>
          permissions.every(permission => manifest.permissions?.includes(permission)),
        requestPermission: async (permission: Permission) =>
          manifest.permissions?.includes(permission) ?? false,
        requestPermissions: async (permissions: Permission[]) =>
          permissions.every(permission => manifest.permissions?.includes(permission)),
        getGrantedPermissions: () => [...(manifest.permissions ?? [])],
      },
      storage: {
        get: async <T>(key: string) => this.storage.get(key) as T | undefined,
        set: async <T>(key: string, value: T) => {
          this.storage.set(key, value);
        },
        delete: async key => {
          this.storage.delete(key);
        },
        keys: async () => [...this.storage.keys()],
        clear: async () => {
          this.storage.clear();
        },
      },
      agentRuntimes: {
        register: adapter => {
          if (adapter.type !== descriptor.type) {
            throw new Error(
              `Registered adapter type "${adapter.type}" does not match descriptor "${descriptor.type}"`
            );
          }
          this.adapter = adapter;
        },
        unregister: type => {
          if (this.adapter?.type === type) this.adapter = null;
        },
        createToolBridge: async (): Promise<ProviderToolBridgeEntry | null> => {
          this.options.emitLog(
            'debug',
            'ZClaudia MCP tool bridge is disabled in the lightweight Playground'
          );
          return null;
        },
      },
      exports: api => {
        this.exportedApi = api;
      },
      getPluginAPI: <T>() => this.exportedApi as T | undefined,
      log: {
        debug: (...values) => log('debug', values),
        info: (...values) => log('info', values),
        warn: (...values) => log('warn', values),
        error: (...values) => log('error', values),
      },
      env: {
        isDesktop: false,
        isServer: true,
        appVersion: this.options.appVersion,
        platform: process.platform as 'darwin' | 'win32' | 'linux',
      },
    } as PluginContext & Record<string, unknown>;
  }
}
