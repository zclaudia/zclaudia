import type { Project, Automation } from '@zclaudia/shared';

export type AutomationTab = 'automations' | 'activity' | 'workflows' | 'runs' | 'system';

export interface OpenAutomationsOptions {
  tab?: AutomationTab;
  projectId?: string;
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

export const CATEGORY_COLORS: Record<string, string> = {
  ai: 'bg-muted/60 text-primary',
  git: 'bg-success/15 text-success',
  maintenance: 'bg-warning/15 text-warning',
  quality: 'bg-thinking/15 text-thinking',
  scheduling: 'bg-muted/60 text-primary',
  sync: 'bg-success/15 text-success',
  supervision: 'bg-thinking/15 text-thinking',
  plugin: 'bg-muted text-muted-foreground',
};

export function automationToItem(a: Automation, workflowNames?: Map<string, string>): AutomationItem {
  const trigger = a.trigger;
  const triggerSummary = !trigger ? 'manual'
    : trigger.type === 'cron' ? `cron: ${trigger.cron}`
    : trigger.type === 'interval' ? `every ${trigger.intervalMinutes}m`
    : trigger.type === 'once' ? 'once'
    : trigger.type === 'event' ? `event: ${trigger.event}`
    : trigger.type;
  const actionSummary = a.action.kind === 'workflow'
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
  };
}
