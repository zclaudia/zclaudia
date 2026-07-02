import * as fs from 'fs';
import type Database from 'better-sqlite3';
import type {
  CommandHandler as PluginCommandHandler,
  Permission,
  PluginContext,
  PluginInstance,
  ToolRegistration,
  UIExtensionRegistration,
  WorkflowStepHandler,
} from '@zclaudia/shared/plugin-types';
import type { ServerMessage } from '@zclaudia/shared/wire/messages';
import { pluginEvents, type EventData, type EventListener } from '../../infra/events/index.js';
import { mcpClientManager } from '../../utils/mcp-client-manager.js';
import { loadMcpServersFromDb } from '../../utils/mcp-config.js';
import { commandRegistry } from '../commands/registry.js';
import { createProviderAPI } from './provider-api.js';
import { permissionManager } from './permissions.js';
import { pluginScheduler } from './scheduler.js';
import { pluginStorageManager } from './storage.js';
import { toolRegistry } from './tool-registry.js';
import { workflowStepRegistry } from './workflow-step-registry.js';
import type { CommandHandler as ServerCommandHandler } from '../commands/registry.js';

type PluginDatabase = Database.Database;
type RuntimePluginContext = PluginContext & Record<string, unknown>;
type RuntimeToolRegistration = ToolRegistration & { permissions?: Permission[] };

export interface PluginContextOptions {
  pluginId: string;
  instance: PluginInstance | undefined;
  db: PluginDatabase | null;
  broadcast: ((msg: ServerMessage) => void) | null;
  pluginAPIs: Map<string, unknown>;
}

/**
 * Creates the runtime API object passed to a plugin module's activate().
 *
 * Keeping this out of PluginLoader makes the loader responsible for lifecycle
 * orchestration, while this module owns the plugin-facing API surface.
 */
export function createPluginContext(options: PluginContextOptions): RuntimePluginContext {
  const { pluginId, instance, db, broadcast, pluginAPIs } = options;
  const manifest = instance?.manifest;

  return {
    pluginId,
    version: manifest?.version || '0.0.0',
    extensionPath: instance?.path || '',

    storage: pluginStorageManager.getStorage(pluginId),

    events: {
      on: (event: string, handler: (data: unknown) => void | Promise<void>) => {
        return pluginEvents.on(event, handler, pluginId);
      },
      once: (event: string, handler: (data: unknown) => void | Promise<void>) => {
        pluginEvents.once(event, handler, pluginId);
      },
      off: (event: string, handler: (data: unknown) => void | Promise<void>) => {
        pluginEvents.off(event, handler as EventListener);
      },
      emit: async (event: string, data: unknown = {}) => {
        await pluginEvents.emit(event, data as EventData, pluginId);
      },
    },

    log: {
      info: (message: string, ...args: unknown[]) => {
        console.log(`[${pluginId}] ${message}`, ...args);
      },
      warn: (message: string, ...args: unknown[]) => {
        console.warn(`[${pluginId}] ${message}`, ...args);
      },
      error: (message: string, ...args: unknown[]) => {
        console.error(`[${pluginId}] ${message}`, ...args);
      },
      debug: (message: string, ...args: unknown[]) => {
        console.debug(`[${pluginId}] ${message}`, ...args);
      },
    },

    commands: {
      registerCommand: (command: string, handler: PluginCommandHandler) => {
        const normalized = command.startsWith('/') ? command : `/${command}`;
        const existing = commandRegistry.get(normalized);
        const description =
          existing?.pluginId === pluginId && existing.description
            ? existing.description
            : `Command from ${pluginId}`;
        commandRegistry.register({
          command: normalized,
          description,
          handler: handler as ServerCommandHandler,
          source: 'plugin',
          pluginId,
        });
      },
      unregisterCommand: (command: string) => {
        const normalized = command.startsWith('/') ? command : `/${command}`;
        commandRegistry.unregister(normalized);
      },
    },

    tools: {
      registerTool: (tool: RuntimeToolRegistration) => {
        toolRegistry.register({
          id: tool.id,
          definition: {
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          },
          handler: tool.handler,
          source: 'plugin',
          pluginId,
          permissions: tool.permissions,
        });
      },
      unregisterTool: (toolId: string) => {
        toolRegistry.unregister(toolId);
      },
    },

    registerUIExtension: (_extension: UIExtensionRegistration): void => {
      throw new Error(
        'Runtime UI extension registration is not available; declare UI in manifest.'
      );
    },

    workflowSteps: {
      registerWorkflowStep: (stepId: string, handler: WorkflowStepHandler) => {
        const fullType = `${pluginId}/${stepId}`;
        const existing = workflowStepRegistry.get(fullType);
        if (existing) {
          workflowStepRegistry.register({ ...existing, handler });
        } else {
          workflowStepRegistry.register({
            type: fullType,
            name: stepId,
            description: `Workflow step from ${pluginId}`,
            category: 'Plugins',
            handler,
            pluginId,
          });
        }
        broadcast?.({ type: 'workflow_step_types_changed' });
      },
      unregisterWorkflowStep: (stepId: string) => {
        workflowStepRegistry.unregister(`${pluginId}/${stepId}`);
        broadcast?.({ type: 'workflow_step_types_changed' });
      },
    },

    permissions: {
      hasPermission: (permission: Permission): boolean => {
        return permissionManager.hasPermission(pluginId, permission);
      },
      hasAllPermissions: (permissions: Permission[]): boolean => {
        return permissionManager.hasAllPermissions(pluginId, permissions);
      },
      requestPermission: async (permission: Permission): Promise<boolean> => {
        if (!manifest) return false;
        return permissionManager.request(pluginId, [permission], manifest);
      },
      requestPermissions: async (permissions: Permission[]): Promise<boolean> => {
        if (!manifest) return false;
        return permissionManager.request(pluginId, permissions, manifest);
      },
      getGrantedPermissions: (): Permission[] => {
        return permissionManager.getGrantedPermissions(pluginId);
      },
    },

    // File System API (requires fs.read / fs.write permissions)
    fs: (() => {
      const hasRead = permissionManager.hasPermission(pluginId, 'fs.read' as Permission);
      const hasWrite = permissionManager.hasPermission(pluginId, 'fs.write' as Permission);
      if (!hasRead && !hasWrite) return undefined;
      return {
        readFile: async (filePath: string): Promise<string> => {
          if (!permissionManager.hasPermission(pluginId, 'fs.read' as Permission))
            throw new Error('Permission denied: fs.read');
          return fs.promises.readFile(filePath, 'utf-8');
        },
        writeFile: async (filePath: string, content: string): Promise<void> => {
          if (!permissionManager.hasPermission(pluginId, 'fs.write' as Permission))
            throw new Error('Permission denied: fs.write');
          await fs.promises.writeFile(filePath, content, 'utf-8');
        },
        exists: async (filePath: string): Promise<boolean> => {
          return fs.existsSync(filePath);
        },
        readdir: async (dirPath: string): Promise<string[]> => {
          if (!permissionManager.hasPermission(pluginId, 'fs.read' as Permission))
            throw new Error('Permission denied: fs.read');
          return fs.promises.readdir(dirPath);
        },
        mkdir: async (dirPath: string): Promise<void> => {
          if (!permissionManager.hasPermission(pluginId, 'fs.write' as Permission))
            throw new Error('Permission denied: fs.write');
          await fs.promises.mkdir(dirPath, { recursive: true });
        },
        unlink: async (filePath: string): Promise<void> => {
          if (!permissionManager.hasPermission(pluginId, 'fs.write' as Permission))
            throw new Error('Permission denied: fs.write');
          await fs.promises.unlink(filePath);
        },
      };
    })(),

    // Network API (requires network.fetch permission)
    network: permissionManager.hasPermission(pluginId, 'network.fetch' as Permission)
      ? {
          fetch: async (
            url: string,
            options?: Record<string, unknown>
          ): Promise<{ ok: boolean; status: number; body: string }> => {
            if (!permissionManager.hasPermission(pluginId, 'network.fetch' as Permission))
              throw new Error('Permission denied: network.fetch');
            const response = await globalThis.fetch(url, options as RequestInit);
            const body = await response.text();
            return { ok: response.ok, status: response.status, body };
          },
        }
      : undefined,

    // Shell API (requires shell.execute permission)
    shell: permissionManager.hasPermission(pluginId, 'shell.execute' as Permission)
      ? {
          execute: async (
            command: string,
            args?: string[],
            execOptions?: { cwd?: string }
          ): Promise<{ stdout: string; stderr: string; code: number }> => {
            if (!permissionManager.hasPermission(pluginId, 'shell.execute' as Permission))
              throw new Error('Permission denied: shell.execute');
            const { execFile } = await import('child_process');
            return new Promise(resolve => {
              execFile(command, args || [], { cwd: execOptions?.cwd }, (error, stdout, stderr) => {
                resolve({
                  stdout: stdout || '',
                  stderr: stderr || '',
                  code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
                });
              });
            });
          },
        }
      : undefined,

    // Notification API (requires notification permission)
    notification: permissionManager.hasPermission(pluginId, 'notification' as Permission)
      ? {
          show: async (
            title: string,
            body: string,
            notificationOptions?: { notchTab?: string }
          ): Promise<void> => {
            if (!permissionManager.hasPermission(pluginId, 'notification' as Permission))
              throw new Error('Permission denied: notification');
            const notchTab = notificationOptions?.notchTab
              ? `${pluginId}/${notificationOptions.notchTab}`
              : undefined;
            pluginEvents
              .emit('plugin.notification', { pluginId, title, body, notchTab })
              .catch(() => {});
            broadcast?.({ type: 'plugin_notification', pluginId, title, body, notchTab });
          },
        }
      : undefined,

    // Scheduler API (requires timer permission)
    scheduler: permissionManager.hasPermission(pluginId, 'timer' as Permission)
      ? {
          register: (
            task: { id: string; name: string; intervalMs: number; immediate?: boolean },
            handler: () => Promise<void> | void
          ) => {
            return pluginScheduler.register(
              pluginId,
              task.id,
              task.name,
              task.intervalMs,
              handler,
              task.immediate !== false
            );
          },
          unregister: (taskId: string) => {
            pluginScheduler.unregister(`plugin:${pluginId}/${taskId}`);
          },
          trigger: async (taskId: string) => {
            await pluginScheduler.trigger(`plugin:${pluginId}/${taskId}`);
          },
        }
      : undefined,

    // Clipboard API (requires clipboard.read / clipboard.write permissions)
    clipboard: (() => {
      const hasRead = permissionManager.hasPermission(pluginId, 'clipboard.read' as Permission);
      const hasWrite = permissionManager.hasPermission(pluginId, 'clipboard.write' as Permission);
      if (!hasRead && !hasWrite) return undefined;
      return {
        read: async (): Promise<string> => {
          throw new Error('Clipboard read requires desktop environment');
        },
        write: async (_text: string): Promise<void> => {
          throw new Error('Clipboard write requires desktop environment');
        },
      };
    })(),

    // Session API (requires session.read permission)
    session:
      permissionManager.hasPermission(pluginId, 'session.read' as Permission) && db
        ? {
            getActive: async () => null,
            getById: async (id: string) => {
              return (
                db
                  .prepare(
                    'SELECT id, project_id as projectId, name, created_at as createdAt, updated_at as updatedAt FROM sessions WHERE id = ?'
                  )
                  .get(id) || null
              );
            },
            list: async () => {
              return db
                .prepare(
                  'SELECT id, project_id as projectId, name, created_at as createdAt, updated_at as updatedAt FROM sessions WHERE archived_at IS NULL ORDER BY updated_at DESC LIMIT 50'
                )
                .all();
            },
          }
        : undefined,

    // Project API (requires project.read permission)
    project:
      permissionManager.hasPermission(pluginId, 'project.read' as Permission) && db
        ? {
            getActive: async () => null,
            getById: async (id: string) => {
              return (
                db
                  .prepare('SELECT id, name, root_path as path FROM projects WHERE id = ?')
                  .get(id) || null
              );
            },
            list: async () => {
              return db
                .prepare(
                  'SELECT id, name, root_path as path FROM projects ORDER BY updated_at DESC LIMIT 50'
                )
                .all();
            },
          }
        : undefined,

    // Provider API (requires provider.call permission)
    providers:
      db && permissionManager.hasPermission(pluginId, 'provider.call')
        ? createProviderAPI(db, pluginId)
        : undefined,

    // MCP API (requires network.fetch permission; operates through server-side manager)
    mcp:
      permissionManager.hasPermission(pluginId, 'network.fetch') && db
        ? {
            listServers: async () => {
              const rows = db
                .prepare('SELECT name, enabled, description FROM mcp_servers ORDER BY name ASC')
                .all() as Array<{ name: string; enabled: number; description: string | null }>;
              return rows.map(r => ({
                name: r.name,
                enabled: !!r.enabled,
                description: r.description || undefined,
              }));
            },
            listTools: async (serverName: string) => {
              const config = loadMcpServersFromDb(db)[serverName];
              if (!config) return [];
              const tools = await mcpClientManager.listTools(serverName, config);
              return tools.map(
                (t: {
                  name: string;
                  description?: string;
                  inputSchema?: Record<string, unknown>;
                }) => ({
                  name: t.name,
                  description: t.description,
                  inputSchema: t.inputSchema,
                })
              );
            },
            callTool: async <T = unknown>(
              serverName: string,
              tool: string,
              args: Record<string, unknown>
            ): Promise<T> => {
              const config = loadMcpServersFromDb(db)[serverName];
              if (!config) throw new Error(`MCP server "${serverName}" not found or disabled`);
              const result = await mcpClientManager.callTool(serverName, config, tool, args);
              const content = (result as { content?: Array<{ type: string; text?: string }> })
                ?.content;
              const text = content?.find(c => c.type === 'text')?.text;
              try {
                return text ? (JSON.parse(text) as T) : (result as T);
              } catch {
                console.debug(
                  `[PluginContext] MCP callTool (${serverName}.${tool}) returned non-JSON:`,
                  text?.slice(0, 100)
                );
                return (text ?? result) as T;
              }
            },
          }
        : undefined,

    capabilities: instance?.capabilities,

    ui: {
      components: { Button: null, Input: null, Card: null, Badge: null },
      showPanel: (panelId: string) => {
        broadcast?.({ type: 'plugin_show_panel', pluginId, panelId });
      },
      showNotification: (message: string) => {
        broadcast?.({ type: 'plugin_notification', pluginId, title: pluginId, body: message });
      },
    },

    exports: <T>(api: T): void => {
      pluginAPIs.set(pluginId, api);
    },
    getPluginAPI: <T>(targetPluginId: string): T | undefined => {
      return pluginAPIs.get(targetPluginId) as T | undefined;
    },

    env: {
      isDesktop: true,
      isServer: true,
      appVersion: '0.1.0',
      platform: process.platform as 'darwin' | 'win32' | 'linux',
    },
  };
}
