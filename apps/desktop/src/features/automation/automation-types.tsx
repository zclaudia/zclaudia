import type { Project, Automation } from '@zclaudia/shared';
import type { Tone } from '../../components/ui/tone';

export type AutomationTab = 'automations' | 'activity' | 'workflows' | 'runs' | 'system';

export interface OpenAutomationsOptions {
  tab?: AutomationTab;
  projectId?: string;
  /** Backend the project lives on; narrows the backend filter to it. */
  backendId?: string;
}

/** One backend as the automation tabs see it (mirrors AgentsBackend). */
export interface AutomationBackend {
  backendId: string;
  name: string;
  online: boolean;
}

export type ProjectInfo = Pick<Project, 'id' | 'name' | 'permissionWorkflowOverrideId'>;

export interface AgentConfigInfo {
  permissionWorkflowOverrideId: string | null;
}

export interface AutomationItem {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  projectId?: string;
  triggerSummary: string;
  actionSummary: string;
  source: 'automation';
  status: string;
  runCount: number;
  lastError?: string;
  isSystem?: boolean;
}

export function isInternalProject(name: string): boolean {
  return name.startsWith('__');
}

export function displayProjectName(name: string): string {
  if (!isInternalProject(name)) return name;
  const stripped = name.replace(/^_+/, '');
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

export function formatInterval(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  return `${Math.round(ms / 3600000)}h`;
}

/** Semantic tone per workflow/system-task category; rendered through TONE_BADGE. */
export const CATEGORY_TONE: Record<string, Tone> = {
  ai: 'info',
  git: 'success',
  maintenance: 'warning',
  quality: 'thinking',
  scheduling: 'info',
  sync: 'success',
  supervision: 'thinking',
  plugin: 'neutral',
};

export function categoryTone(category: string | undefined): Tone {
  return (category && CATEGORY_TONE[category.toLowerCase()]) || 'neutral';
}

export function automationToItem(
  a: Automation,
  workflowNames?: Map<string, string>
): AutomationItem {
  const trigger = a.trigger;
  const triggerSummary = !trigger
    ? 'manual'
    : trigger.type === 'cron'
      ? `cron: ${trigger.cron}`
      : trigger.type === 'interval'
        ? `every ${trigger.intervalMinutes}m`
        : trigger.type === 'once'
          ? 'once'
          : trigger.type === 'event'
            ? `event: ${trigger.event}`
            : trigger.type;
  const actionSummary =
    a.action.kind === 'workflow'
      ? (workflowNames?.get(a.action.ref) ?? `workflow: ${a.action.ref.slice(0, 8)}`)
      : a.action.ref;
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    enabled: a.enabled,
    projectId: a.projectId,
    triggerSummary,
    actionSummary,
    source: 'automation',
    status: a.enabled ? 'idle' : 'disabled',
    runCount: 0,
    isSystem: a.isSystem,
  };
}
