import * as api from '../../services/api';
import { activateGoal } from '../../services/goalActions';
import { pauseGoal, resumeGoal, clearGoal } from '../../services/api/goals';
import { useSessionConfigStore } from '../../stores/sessionConfigStore';
import { useSupervisionStore } from '../../stores/supervisionStore';
import { useGoalStore } from '../../stores/goalStore';
import { registerClientAction, type ClientActionContext } from './clientActions';

/**
 * The former hard-coded branches of `useCommandHandler.handleCommand`,
 * extracted one-by-one into registered client actions (URIP §12.4). Each body
 * is the pre-migration behavior, unchanged.
 */

function requireMainSupervisor(ctx: ClientActionContext): boolean {
  return ctx.services.currentSession?.projectRole === 'main' && !!ctx.services.currentProject?.id;
}

registerClientAction({
  actionId: 'zc.help',
  execute: ctx => {
    const grouped: Record<string, typeof ctx.services.commands> = {};
    for (const cmd of ctx.services.commands) {
      const label =
        cmd.source === 'local'
          ? 'Built-in Commands'
          : cmd.source === 'provider'
            ? 'Provider Commands'
            : cmd.source === 'custom'
              ? 'Custom Commands'
              : cmd.source === 'plugin'
                ? 'Plugin Commands'
                : 'Other Commands';
      (grouped[label] ||= []).push(cmd);
    }
    const sections = Object.entries(grouped)
      .map(
        ([label, cmds]) =>
          `**${label}:**\n\n${cmds.map(c => `- \`${c.command}\` — ${c.description}`).join('\n')}`
      )
      .join('\n\n');
    ctx.addSystemMessage(sections);
  },
});

registerClientAction({
  actionId: 'zc.context',
  execute: async ctx => {
    try {
      const result = await api.getSessionContextUsage(ctx.sessionId);
      if (!result.available) {
        ctx.addSystemMessage(
          'No context data yet — send a message first, then try /context again.'
        );
      } else {
        const { available: _available, ...contextUsage } = result;
        ctx.addSystemMessage('Context window usage', { contextUsage });
      }
    } catch (err) {
      ctx.addSystemMessage(`Failed to get context usage: ${(err as Error).message}`);
    }
  },
});

registerClientAction({
  actionId: 'zc.worktree',
  execute: async ctx => {
    if (ctx.services.isForcedPlanSession) {
      ctx.addSystemMessage('Worktree is locked during Supervisor planning mode.');
      return;
    }
    const trimmedArgs = ctx.args.trim();
    if (!trimmedArgs) {
      const current =
        ctx.services.currentSession?.workingDirectory ||
        ctx.services.currentProject?.rootPath ||
        '(unknown)';
      ctx.addSystemMessage(
        `Current worktree: \`${current}\`\n\n**Usage:**\n- \`/worktree <path>\` — switch to an existing worktree path\n- \`/worktree reset\` — reset to project root\n- \`/create-worktree [branch] [path]\` — create a new worktree`
      );
      return;
    }
    if (trimmedArgs === 'reset') {
      await ctx.services.switchWorktree('');
      ctx.addSystemMessage('Worktree reset to project root.');
      return;
    }
    try {
      await ctx.services.switchWorktree(trimmedArgs);
      ctx.addSystemMessage(`Worktree set to: \`${trimmedArgs}\``);
    } catch (err) {
      ctx.addSystemMessage(`Failed to set worktree: ${(err as Error).message}`);
    }
  },
});

registerClientAction({
  actionId: 'zc.new-cli-session',
  execute: async ctx => {
    try {
      await api.resetSessionSdkSession(ctx.sessionId);
      useSessionConfigStore.getState().clearSessionUsage(ctx.sessionId);
      ctx.addSystemMessage(
        'Underlying CLI session reset. The next message will start a new provider-side session.'
      );
    } catch (err) {
      ctx.addSystemMessage(`Failed to reset CLI session: ${(err as Error).message}`);
    }
  },
});

registerClientAction({
  actionId: 'zc.create-worktree',
  execute: async ctx => {
    if (ctx.services.isForcedPlanSession) {
      ctx.addSystemMessage('Worktree is locked during Supervisor planning mode.');
      return;
    }
    if (!ctx.services.currentProject?.id) {
      ctx.addSystemMessage('No project associated with this session.');
      return;
    }
    const parts = ctx.args.trim().split(/\s+/).filter(Boolean);
    const branch = parts[0];
    const wtPath = parts[1];
    try {
      const wt = await api.createProjectWorktree(
        ctx.services.currentProject.id,
        branch || '',
        wtPath
      );
      await ctx.services.switchWorktree(wt.path);
      ctx.addSystemMessage(
        `Worktree created and activated:\n- **Branch:** \`${wt.branch}\`\n- **Path:** \`${wt.path}\``
      );
    } catch (err) {
      ctx.addSystemMessage(`Failed to create worktree: ${(err as Error).message}`);
    }
  },
});

registerClientAction({
  actionId: 'zc.goal',
  execute: async ctx => {
    const objective = ctx.args.trim();
    const sub = objective.toLowerCase();
    const store = useGoalStore.getState();
    const current = store.bySession[ctx.sessionId]?.goal ?? null;
    const live = !!current && (current.status === 'active' || current.status === 'paused');

    if (!objective) {
      ctx.addSystemMessage(
        'Usage: /goal <objective> — set an autonomous goal. Control it with `/goal pause`, `/goal resume`, or `/goal clear`.'
      );
      return;
    }

    if (live && (sub === 'pause' || sub === 'resume' || sub === 'clear')) {
      try {
        if (sub === 'clear') {
          await clearGoal(ctx.sessionId);
          store.setGoal(ctx.sessionId, null);
        } else {
          const next =
            sub === 'pause' ? await pauseGoal(ctx.sessionId) : await resumeGoal(ctx.sessionId);
          store.setGoal(ctx.sessionId, next);
        }
        ctx.addSystemMessage(
          sub === 'pause' ? 'Goal paused.' : sub === 'resume' ? 'Goal resumed.' : 'Goal cleared.'
        );
      } catch (err) {
        ctx.addSystemMessage(`Failed to ${sub} goal: ${(err as Error).message}`);
      }
      return;
    }

    try {
      await activateGoal(ctx.sessionId, { objective });
    } catch (err) {
      ctx.addSystemMessage(`Failed to set goal: ${(err as Error).message}`);
    }
  },
});

registerClientAction({
  actionId: 'zc.create-task',
  execute: async ctx => {
    if (!requireMainSupervisor(ctx)) return;
    const title = ctx.args.trim();
    if (!title) {
      ctx.addSystemMessage('Usage: `/create-task <title>` — create a new supervision task');
      return;
    }
    try {
      const task = await api.createSupervisionTask(ctx.services.currentProject!.id, {
        title,
        description: '',
      });
      ctx.addSystemMessage(`Task created: **${task.title}** (${task.status})`);
      useSupervisionStore.getState().upsertTask(ctx.services.currentProject!.id, task);
    } catch (err) {
      ctx.addSystemMessage(`Failed to create task: ${(err as Error).message}`);
    }
  },
});

registerClientAction({
  actionId: 'zc.status',
  execute: async ctx => {
    if (!requireMainSupervisor(ctx)) return;
    try {
      const tasks = await api.getSupervisionTasks(ctx.services.currentProject!.id);
      const agentData = await api.getSupervisionAgent(ctx.services.currentProject!.id);
      const lines: string[] = [];
      lines.push(
        `**Agent**: ${agentData?.phase ?? 'unknown'} | Trust: ${agentData?.config.trustLevel ?? '?'} | Concurrent: ${agentData?.config.maxConcurrentTasks ?? '?'}`
      );
      if (tasks.length === 0) {
        lines.push('\nNo tasks yet. Use `/create-task <title>` to add one.');
      } else {
        const grouped: Record<string, typeof tasks> = {};
        for (const t of tasks) {
          (grouped[t.status] ??= []).push(t);
        }
        for (const [status, items] of Object.entries(grouped)) {
          lines.push(`\n**${status}** (${items.length})`);
          for (const t of items) {
            lines.push(`- ${t.title}${t.priority > 0 ? ` [P${t.priority}]` : ''}`);
          }
        }
      }
      ctx.addSystemMessage(lines.join('\n'));
    } catch (err) {
      ctx.addSystemMessage(`Failed to get status: ${(err as Error).message}`);
    }
  },
});

registerClientAction({
  actionId: 'zc.pause',
  execute: async ctx => {
    if (!requireMainSupervisor(ctx)) return;
    try {
      await api.updateSupervisionAgentAction(ctx.services.currentProject!.id, 'pause');
      ctx.addSystemMessage('Supervision agent paused.');
    } catch (err) {
      ctx.addSystemMessage(`Failed to pause: ${(err as Error).message}`);
    }
  },
});

registerClientAction({
  actionId: 'zc.resume',
  execute: async ctx => {
    if (!requireMainSupervisor(ctx)) return;
    try {
      await api.updateSupervisionAgentAction(ctx.services.currentProject!.id, 'resume');
      ctx.addSystemMessage('Supervision agent resumed.');
    } catch (err) {
      ctx.addSystemMessage(`Failed to resume: ${(err as Error).message}`);
    }
  },
});
