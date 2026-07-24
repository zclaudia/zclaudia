import type { PCPEffectiveProfile } from '@zclaudia/shared/core/pcp';
import { shouldExposeInteractionTool } from '../../infra/providers/pcp-capability.js';
import { toolRegistry, type ToolRegistry, type ToolScope } from './tool-registry.js';

export interface AgentToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface AgentToolCallContext {
  sessionId?: string;
  signal: AbortSignal;
}

/**
 * Structural equivalent of @zclaudia/agent-tool-bridge's ToolCatalog.
 *
 * Keeping this host port free of the package import lets ZClaudia build before
 * the new public package is published. Once installed, TypeScript will verify
 * this object against that package without changing its implementation.
 */
export interface AgentToolCatalog {
  listTools(context: { sessionId?: string }): AgentToolDefinition[];
  callTool(
    name: string,
    args: Record<string, unknown>,
    context: AgentToolCallContext
  ): Promise<string>;
}

export interface ZClaudiaToolCatalogDeps {
  getActiveProfile?: (sessionId: string) => PCPEffectiveProfile | undefined;
  getSessionType?: (sessionId: string) => string | undefined;
  resolveActiveSessionId?: () => string | undefined;
  registry?: Pick<ToolRegistry, 'execute' | 'getBridgeTools' | 'getDefinitionsByScope'>;
}

let hostCatalogDeps: ZClaudiaToolCatalogDeps = {};

export function configureZClaudiaToolCatalog(deps: ZClaudiaToolCatalogDeps): void {
  hostCatalogDeps = deps;
}

export function getZClaudiaToolCatalog(): AgentToolCatalog {
  return createZClaudiaToolCatalog(hostCatalogDeps);
}

export function resolveAgentToolScope(
  sessionId: string | undefined,
  sessionType: string | undefined
): ToolScope {
  if (!sessionId) return 'plugin-panel';
  if (sessionType === 'agent') return 'agent-assistant';
  return 'main-session';
}

export function createZClaudiaToolCatalog(deps: ZClaudiaToolCatalogDeps = {}): AgentToolCatalog {
  const registry = deps.registry ?? toolRegistry;

  const resolveSessionId = (sessionId?: string): string | undefined =>
    sessionId || deps.resolveActiveSessionId?.();

  const resolveContext = (requestedSessionId?: string) => {
    const sessionId = resolveSessionId(requestedSessionId);
    const sessionType = sessionId ? deps.getSessionType?.(sessionId) : undefined;
    return {
      sessionId,
      profile: sessionId ? deps.getActiveProfile?.(sessionId) : undefined,
      scope: resolveAgentToolScope(sessionId, sessionType),
    };
  };

  return {
    listTools(context) {
      const { profile, scope } = resolveContext(context.sessionId);
      const allowedNames = new Set(
        registry.getDefinitionsByScope(scope).map(definition => definition.function.name)
      );
      return registry
        .getBridgeTools()
        .filter(tool => allowedNames.has(tool.definition.function.name))
        .filter(tool => shouldExposeInteractionTool(tool.definition.function.name, profile))
        .map(tool => ({
          name: tool.definition.function.name,
          description: tool.definition.function.description || '',
          inputSchema: tool.definition.function.parameters || {
            type: 'object',
            properties: {},
          },
        }));
    },

    async callTool(name, args, context) {
      const { profile, scope, sessionId } = resolveContext(context.sessionId);
      if (profile && !shouldExposeInteractionTool(name, profile)) {
        return JSON.stringify({ error: `Tool "${name}" is not available for this provider` });
      }
      if (context.signal.aborted) {
        return JSON.stringify({ error: 'Tool call was aborted before execution.' });
      }
      return registry.execute(name, args, { sessionId }, scope);
    },
  };
}
