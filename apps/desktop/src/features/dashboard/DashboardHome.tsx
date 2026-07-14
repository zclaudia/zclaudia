import { useEffect, useState } from 'react';
import {
  Bot,
  ClipboardList,
  GitBranch,
  GitPullRequest,
  CircleDot,
  Workflow,
  ChevronRight,
  Zap,
  ExternalLink,
  FileText,
} from 'lucide-react';
import type { Automation } from '@zclaudia/shared';
import { useProjectStore } from '../../stores/projectStore';
import { useSupervisionStore } from '../../features/supervision/store';
import { useLocalPRStore } from '../../features/local-pr/store';
import { useLocalIssueStore } from '../../features/local-issues/store';
import { useWorkflowStore } from '../../features/workflows/store';
import { useGitStore } from '../../features/git/store';
import { useOwnershipStore } from '../../stores/ownershipStore';
import { apiCallForBackend } from '../../services/api/unwrap';
import type { DashboardView } from './ProjectDashboard';

interface DashboardHomeProps {
  projectId: string;
  projectRootPath?: string;
  onNavigate: (view: DashboardView) => void;
  onOpenAutomations?: (opts: { tab: 'automations' | 'workflows'; projectId: string }) => void;
  onOpenDashboardWindow?: (projectId: string) => void;
}

// ---------------------------------------------------------------------------
// Status badge helpers
// ---------------------------------------------------------------------------

const GLYPH_ORANGE_BG = 'bg-[hsl(var(--glyph-orange)/0.1)]';
const GLYPH_ORANGE_TEXT = 'text-[hsl(var(--glyph-orange))]';

const PR_STATUS_COLORS: Record<string, string> = {
  open: 'bg-primary/10 text-primary',
  reviewing: 'bg-warning/10 text-warning',
  review_failed: 'bg-destructive/10 text-destructive',
  approved: 'bg-success/10 text-success',
  merging: 'bg-thinking/10 text-thinking',
  conflict: 'bg-destructive/10 text-destructive',
  merged: 'bg-muted text-muted-foreground',
  closed: 'bg-muted text-muted-foreground',
};

const ISSUE_STATUS_COLORS: Record<string, string> = {
  open: 'bg-success/10 text-success',
  in_progress: 'bg-primary/10 text-primary',
  closed: 'bg-muted text-muted-foreground',
};

const ISSUE_PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-primary/10 text-primary',
  high: `${GLYPH_ORANGE_BG} ${GLYPH_ORANGE_TEXT}`,
  critical: 'bg-destructive/10 text-destructive',
};

const TASK_STATUS_COLORS: Record<string, string> = {
  proposed: `${GLYPH_ORANGE_BG} ${GLYPH_ORANGE_TEXT}`,
  pending: 'bg-muted text-muted-foreground',
  queued: 'bg-primary/10 text-primary',
  planning: 'bg-warning/10 text-warning',
  running: 'bg-success/10 text-success',
  reviewing: 'bg-warning/10 text-warning',
  approved: 'bg-success/10 text-success',
  integrated: 'bg-success/10 text-success',
  merge_conflict: 'bg-destructive/10 text-destructive',
  failed: 'bg-destructive/10 text-destructive',
  rejected: 'bg-destructive/10 text-destructive',
  blocked: `${GLYPH_ORANGE_BG} ${GLYPH_ORANGE_TEXT}`,
  cancelled: 'bg-muted text-muted-foreground',
  completed: 'bg-success/10 text-success',
};

function StatusBadge({ status, colors }: { status: string; colors: Record<string, string> }) {
  return (
    <span
      className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${colors[status] ?? 'bg-muted text-muted-foreground'}`}
    >
      {status.replace('_', ' ')}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const PHASE_CONFIG: Record<string, { label: string; color: string }> = {
  initializing: { label: 'Initializing', color: 'text-primary' },
  setup: { label: 'Setup', color: 'text-warning' },
  active: { label: 'Active', color: 'text-success' },
  paused: { label: 'Paused', color: GLYPH_ORANGE_TEXT },
  idle: { label: 'Idle', color: 'text-muted-foreground' },
  archived: { label: 'Archived', color: 'text-muted-foreground' },
};

export function DashboardHome({
  projectId,
  onNavigate,
  onOpenAutomations,
  onOpenDashboardWindow,
}: DashboardHomeProps) {
  const project = useProjectStore(s => s.projects.find(p => p.id === projectId));

  // Supervisor agent
  const agent = useSupervisionStore(s => s.agents[projectId]) ?? null;
  const agentPhase = agent
    ? (PHASE_CONFIG[agent.phase] ?? { label: agent.phase, color: 'text-muted-foreground' })
    : null;

  // Tasks
  const tasks = useSupervisionStore(s => s.tasks[projectId]) ?? [];
  const activeTasks = tasks.filter(t => ['running', 'planning', 'reviewing'].includes(t.status));
  const needsAttentionTasks = tasks.filter(t =>
    ['proposed', 'merge_conflict', 'failed', 'rejected', 'blocked'].includes(t.status)
  );
  const queuedTasks = tasks.filter(t => ['queued', 'pending'].includes(t.status));

  // Local PRs
  const prs = useLocalPRStore(s => s.prs[projectId] ?? []);
  const loadPRs = useLocalPRStore(s => s.loadPRs);
  const activePRs = prs.filter(pr => !['merged', 'closed'].includes(pr.status));
  const needsAttentionPRs = prs.filter(pr => ['review_failed', 'conflict'].includes(pr.status));

  // Local Issues
  const allIssues = useLocalIssueStore(s => s.issues[projectId] ?? []);
  const loadIssues = useLocalIssueStore(s => s.loadIssues);
  const openIssues = allIssues.filter(i => i.status === 'open');
  const inProgressIssues = allIssues.filter(i => i.status === 'tracked');

  // Git worktrees
  const worktrees = useGitStore(s => s.worktrees[projectId] ?? []);
  const statusByPath = useGitStore(s => s.statusByPath);
  const dirtyWorktrees = worktrees.filter(w => {
    const status = statusByPath[`${projectId}::${w.path}`];
    return status && !status.clean;
  });

  // Workflows (from /api/workflows — all real workflows now)
  const allWorkflows = useWorkflowStore(s => s.workflows[projectId] ?? []);
  const loadWorkflows = useWorkflowStore(s => s.loadWorkflows);
  const workflows = allWorkflows;
  const activeWorkflows = workflows.filter(w => w.status === 'active');
  const runs = useWorkflowStore(s => s.runs);

  // Automations (from /api/automations)
  const [automations, setAutomations] = useState<Automation[]>([]);
  const activeAutomations = automations.filter(a => a.enabled);

  // Load data on mount
  useEffect(() => {
    loadPRs(projectId).catch(() => {});
    loadIssues(projectId).catch(() => {});
    loadWorkflows(projectId).catch(() => {});
  }, [loadIssues, loadPRs, loadWorkflows, projectId]);

  useEffect(() => {
    if (!projectId) return;
    const backendId = useOwnershipStore.getState().getProjectBackendId(projectId);
    apiCallForBackend<Automation[]>(
      backendId,
      `/api/automations?projectId=${encodeURIComponent(projectId)}`
    )
      .then(setAutomations)
      .catch(() => {});
  }, [projectId]);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">{project?.name ?? 'Project'} Dashboard</h1>
        {onOpenDashboardWindow && (
          <button
            type="button"
            title="Open dashboard in window"
            onClick={() => onOpenDashboardWindow(projectId)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground hover:border-primary/40"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            <span>Open in Window</span>
          </button>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3">
        {/* Supervisor Card */}
        <button
          onClick={() => onNavigate('supervisor')}
          className="text-left bg-card border border-border rounded-lg p-4 hover:border-primary/40 transition-colors group"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">Supervisor</span>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <div className="space-y-1">
            {agent ? (
              <>
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-semibold ${agentPhase?.color}`}>
                    {agentPhase?.label}
                  </span>
                  {agent.phase === 'active' && (
                    <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {(agent.mode ?? 'full') === 'lite' ? 'Workflow' : 'Full Supervisor'}
                </div>
              </>
            ) : (
              <div className="text-xs text-muted-foreground">Not configured</div>
            )}
          </div>
        </button>

        {/* Spec Card */}
        <button
          onClick={() => onNavigate('spec')}
          className="text-left bg-card border border-border rounded-lg p-4 hover:border-primary/40 transition-colors group"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">Spec</span>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">
              Project knowledge &amp; specifications
            </div>
          </div>
        </button>

        {/* Tasks Card */}
        <button
          onClick={() => onNavigate('tasks')}
          className="text-left bg-card border border-border rounded-lg p-4 hover:border-primary/40 transition-colors group"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">Tasks</span>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <div className="space-y-1">
            <div className="text-2xl font-bold">{activeTasks.length}</div>
            <div className="text-xs text-muted-foreground">active</div>
            {needsAttentionTasks.length > 0 && (
              <div className="text-xs text-destructive">
                {needsAttentionTasks.length} needs attention
              </div>
            )}
            {queuedTasks.length > 0 && (
              <div className="text-xs text-muted-foreground">{queuedTasks.length} queued</div>
            )}
          </div>
        </button>

        {/* Local Pull Requests Card */}
        <button
          onClick={() => onNavigate('local-prs')}
          className="text-left bg-card border border-border rounded-lg p-4 hover:border-primary/40 transition-colors group"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <GitPullRequest className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">Local Pull Requests</span>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <div className="space-y-1">
            <div className="text-2xl font-bold">{activePRs.length}</div>
            <div className="text-xs text-muted-foreground">active</div>
            {needsAttentionPRs.length > 0 && (
              <div className="text-xs text-destructive">{needsAttentionPRs.length} needs attention</div>
            )}
          </div>
        </button>

        {/* Issues Card */}
        <button
          onClick={() => onNavigate('issues')}
          className="text-left bg-card border border-border rounded-lg p-4 hover:border-primary/40 transition-colors group"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <CircleDot className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">Issues</span>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <div className="space-y-1">
            <div className="text-2xl font-bold">{openIssues.length}</div>
            <div className="text-xs text-muted-foreground">open</div>
            {inProgressIssues.length > 0 && (
              <div className="text-xs text-primary">{inProgressIssues.length} in progress</div>
            )}
          </div>
        </button>

        {/* Git Card */}
        <button
          onClick={() => onNavigate('git')}
          className="text-left bg-card border border-border rounded-lg p-4 hover:border-primary/40 transition-colors group"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">Git</span>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <div className="space-y-1">
            <div className="text-2xl font-bold">{worktrees.length}</div>
            <div className="text-xs text-muted-foreground">
              worktree{worktrees.length === 1 ? '' : 's'}
            </div>
            {dirtyWorktrees.length > 0 && (
              <div className={`text-xs ${GLYPH_ORANGE_TEXT}`}>{dirtyWorktrees.length} with changes</div>
            )}
          </div>
        </button>

        {onOpenAutomations && (
          <>
            {/* Workflows Card */}
            <button
              onClick={() => onOpenAutomations?.({ tab: 'workflows', projectId })}
              className="text-left bg-card border border-border rounded-lg p-4 hover:border-primary/40 transition-colors group"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Workflow className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Workflows</span>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <div className="space-y-1">
                <div className="text-2xl font-bold">{activeWorkflows.length}</div>
                <div className="text-xs text-muted-foreground">active</div>
                {workflows.length > activeWorkflows.length && (
                  <div className="text-xs text-muted-foreground">
                    {workflows.length - activeWorkflows.length} disabled
                  </div>
                )}
              </div>
            </button>

            {/* Automations Card */}
            <button
              onClick={() => onOpenAutomations?.({ tab: 'automations', projectId })}
              className="text-left bg-card border border-border rounded-lg p-4 hover:border-primary/40 transition-colors group"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Automations</span>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <div className="space-y-1">
                <div className="text-2xl font-bold">{activeAutomations.length}</div>
                <div className="text-xs text-muted-foreground">active</div>
                {automations.length > activeAutomations.length && (
                  <div className="text-xs text-muted-foreground">
                    {automations.length - activeAutomations.length} disabled
                  </div>
                )}
              </div>
            </button>
          </>
        )}
      </div>

      {/* Local Pull Requests Preview */}
      {activePRs.length > 0 && (
        <PreviewSection title="Local Pull Requests" onViewAll={() => onNavigate('local-prs')}>
          {activePRs.slice(0, 3).map(pr => (
            <div key={pr.id} className="flex items-center justify-between py-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <StatusBadge status={pr.status} colors={PR_STATUS_COLORS} />
                <span className="text-sm truncate">{pr.title}</span>
                <span className="text-xs text-muted-foreground font-mono truncate">
                  {pr.branchName}
                </span>
              </div>
            </div>
          ))}
        </PreviewSection>
      )}

      {/* Tasks Preview */}
      {tasks.filter(t => !['completed', 'integrated', 'cancelled'].includes(t.status)).length >
        0 && (
        <PreviewSection title="Tasks" onViewAll={() => onNavigate('tasks')}>
          {tasks
            .filter(t => !['completed', 'integrated', 'cancelled'].includes(t.status))
            .slice(0, 3)
            .map(task => (
              <div key={task.id} className="flex items-center justify-between py-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <StatusBadge status={task.status} colors={TASK_STATUS_COLORS} />
                  <span className="text-sm truncate">{task.title}</span>
                </div>
                <span className="text-xs text-muted-foreground">P{task.priority}</span>
              </div>
            ))}
        </PreviewSection>
      )}

      {/* Workflows Preview */}
      {activeWorkflows.length > 0 && (
        <PreviewSection
          title="Workflows"
          onViewAll={() => onOpenAutomations?.({ tab: 'workflows', projectId })}
        >
          {activeWorkflows.slice(0, 3).map(wf => {
            const latestRun = (runs[wf.id] ?? [])[0];
            const RUN_STATUS_COLORS: Record<string, string> = {
              pending: 'bg-muted text-muted-foreground',
              running: 'bg-primary/10 text-primary',
              completed: 'bg-success/10 text-success',
              failed: 'bg-destructive/10 text-destructive',
              cancelled: 'bg-muted text-muted-foreground',
            };
            return (
              <div key={wf.id} className="flex items-center justify-between py-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-success" />
                  <span className="text-sm truncate">{wf.name}</span>
                </div>
                {latestRun && <StatusBadge status={latestRun.status} colors={RUN_STATUS_COLORS} />}
              </div>
            );
          })}
        </PreviewSection>
      )}

      {/* Issues Preview */}
      {allIssues.filter(i => i.status !== 'closed').length > 0 && (
        <PreviewSection title="Issues" onViewAll={() => onNavigate('issues')}>
          {allIssues
            .filter(i => i.status !== 'closed')
            .slice(0, 3)
            .map(issue => (
              <div key={issue.id} className="flex items-center justify-between py-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <StatusBadge status={issue.status} colors={ISSUE_STATUS_COLORS} />
                  <span className="text-sm truncate">{issue.title}</span>
                </div>
                <span
                  className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${ISSUE_PRIORITY_COLORS[issue.priority] ?? ''}`}
                >
                  {issue.priority}
                </span>
              </div>
            ))}
        </PreviewSection>
      )}

      {/* Empty state */}
      {tasks.length === 0 &&
        prs.length === 0 &&
        allIssues.length === 0 &&
        allWorkflows.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-sm">No activity yet.</p>
            <p className="text-xs mt-1">
              Create tasks, local PRs, issues, or workflow automations to see them here.
            </p>
          </div>
        )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preview Section
// ---------------------------------------------------------------------------

function PreviewSection({
  title,
  onViewAll,
  children,
}: {
  title: string;
  onViewAll: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {title}
        </h3>
        <button
          onClick={onViewAll}
          className="text-xs text-primary hover:underline flex items-center gap-0.5"
        >
          View All <ChevronRight className="w-3 h-3" />
        </button>
      </div>
      <div className="bg-card border border-border rounded-lg px-3 py-1 divide-y divide-border">
        {children}
      </div>
    </div>
  );
}
