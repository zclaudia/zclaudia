import type { SlashCommand, Session, Project } from '@zclaudia/shared';
import { DESKTOP_HOST_ACTIONS } from '@zclaudia/shared/features/host-actions';

/**
 * Desktop client action registry (URIP design doc §12.4).
 *
 * The composer's former hard-coded command branches (/help, /context,
 * /worktree, /goal, /pause, /resume, …) are extracted into this fixed,
 * desktop-side table. Each action is registered under the canonical
 * `zc.<name>` ID that the server's Host Action Registry advertises with a
 * `/zc:` trigger. The server never sends arbitrary instructions — only these
 * registered action IDs with typed payloads.
 */

export interface ClientActionContext {
  sessionId: string;
  /** Raw argument suffix typed after the trigger (trimmed). */
  args: string;
  addSystemMessage: (content: string, metadata?: Record<string, unknown>) => void;
  services: {
    commands: SlashCommand[];
    currentSession?: Session;
    currentProject?: Project | null;
    isForcedPlanSession: boolean;
    /** Persisted worktree switch shared with the legacy /worktree plumbing. */
    switchWorktree: (path: string) => Promise<void>;
  };
}

export interface ClientActionDefinition {
  actionId: string;
  execute: (ctx: ClientActionContext) => Promise<void> | void;
}

type Registry = Map<string, ClientActionDefinition>;
const registry: Registry = new Map();

export function registerClientAction(definition: ClientActionDefinition): void {
  registry.set(definition.actionId, definition);
}

export function hasClientAction(actionId: string): boolean {
  return registry.has(actionId);
}

export async function dispatchClientAction(
  actionId: string,
  ctx: ClientActionContext
): Promise<boolean> {
  const definition = registry.get(actionId);
  if (!definition) return false;
  await definition.execute(ctx);
  return true;
}

/**
 * Bridge for server-dispatched client actions: when a reserved-namespace text
 * is resolved server-side (§12.2), the reply carries only the registered
 * action ID; the live composer context is supplied here by useCommandHandler.
 */
let liveContextFactory: ((sessionId: string, args: string) => ClientActionContext) | null = null;

export function setClientActionContextFactory(
  factory: (sessionId: string, args: string) => ClientActionContext
): void {
  liveContextFactory = factory;
}

export async function dispatchClientActionFromWire(
  actionId: string,
  sessionId: string
): Promise<boolean> {
  if (!liveContextFactory) return false;
  return dispatchClientAction(actionId, liveContextFactory(sessionId, ''));
}

/** Map a legacy unqualified trigger (`/help`) to its host action name (`help`). */
export function legacyAliasToHostActionName(trigger: string): string | undefined {
  const normalized = `/${trigger.replace(/^\/+/, '')}`;
  const action = DESKTOP_HOST_ACTIONS.find(
    a => a.name === trigger || a.aliases.includes(normalized)
  );
  return action?.name;
}
