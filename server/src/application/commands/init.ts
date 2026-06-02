/**
 * Built-in Commands Registration
 *
 * This file registers all built-in slash commands into the CommandRegistry.
 */

import * as path from 'path';
import * as fs from 'fs';
import type { CommandExecuteResponse } from '@zclaudia/shared/features/commands';
import { LOCAL_COMMANDS } from '@zclaudia/shared/features/commands';
import { commandRegistry, type CommandContext, type CommandHandler } from './registry.js';
import { forceCompact } from '../conversation/compaction/compaction-service.js';

// ============================================
// Helper Functions
// ============================================

// Read package.json for version info
function getPackageInfo(): { name: string; version: string } {
  try {
    const packageJsonPath = path.join(__dirname, '..', '..', '..', 'package.json');
    const content = fs.readFileSync(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(content);
    return { name: pkg.name || 'zclaudia', version: pkg.version || 'unknown' };
  } catch {
    return { name: 'zclaudia', version: 'unknown' };
  }
}

// Format uptime
function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

// ============================================
// Command Handlers
// ============================================

const clearHandler = (_args: string[], _context?: CommandContext): CommandExecuteResponse => ({
  type: 'builtin',
  command: '/clear',
  action: 'clear',
  data: {
    message: 'Conversation history cleared'
  }
});

const helpHandler = (_args: string[], _context?: CommandContext): CommandExecuteResponse => {
  const helpText = `**Built-in Commands:**

${LOCAL_COMMANDS.map(cmd => `- \`${cmd.command}\` — ${cmd.description}`).join('\n')}

**Custom Commands:**

- Project: \`.claude/commands/\` (project-specific)
- User: \`~/.claude/commands/\` (available in all projects)
- Use \`$ARGUMENTS\` or \`$1\`, \`$2\` for args, \`@filename\` for file includes
`;

  return {
    type: 'builtin',
    command: '/help',
    action: 'help',
    data: {
      content: helpText,
      format: 'markdown'
    }
  };
};

const statusHandler = (_args: string[], context?: CommandContext): CommandExecuteResponse => {
  const pkg = getPackageInfo();
  const uptime = process.uptime();

  return {
    type: 'builtin',
    command: '/status',
    action: 'status',
    data: {
      version: pkg.version,
      packageName: pkg.name,
      uptime: formatUptime(uptime),
      uptimeSeconds: Math.floor(uptime),
      model: context?.model || 'unknown',
      provider: context?.provider || 'zclaudia',
      nodeVersion: process.version,
      platform: process.platform,
      projectPath: context?.projectPath || 'N/A'
    }
  };
};

const modelHandler = (_args: string[], context?: CommandContext): CommandExecuteResponse => {
  const model = context?.model || 'default';
  const provider = context?.provider || 'zclaudia';
  let message = '**Model Info:**\n\n';
  message += `- **Model:** ${model}\n`;
  message += `- **Provider:** ${provider}\n`;

  return {
    type: 'builtin',
    command: '/model',
    action: 'model',
    data: { model, provider, message }
  };
};

const costHandler = (_args: string[], context?: CommandContext): CommandExecuteResponse => {
  const tokenUsage = context?.tokenUsage || { used: 0, total: 160000 };
  const percentage = tokenUsage.total > 0
    ? ((tokenUsage.used / tokenUsage.total) * 100).toFixed(1)
    : '0';

  return {
    type: 'builtin',
    command: '/cost',
    action: 'cost',
    data: {
      tokenUsage: {
        used: tokenUsage.used,
        total: tokenUsage.total,
        percentage
      },
      model: context?.model || 'unknown'
    }
  };
};

const memoryHandler = (_args: string[], context?: CommandContext): CommandExecuteResponse => {
  const projectPath = context?.projectPath;

  if (!projectPath) {
    return {
      type: 'builtin',
      command: '/memory',
      action: 'memory',
      data: {
        error: true,
        message: 'No project selected. Please select a project to access its CLAUDE.md file.'
      }
    };
  }

  const claudeMdPath = path.join(projectPath, 'CLAUDE.md');
  const exists = fs.existsSync(claudeMdPath);

  return {
    type: 'builtin',
    command: '/memory',
    action: 'memory',
    data: {
      path: claudeMdPath,
      exists,
      message: exists
        ? `CLAUDE.md found at ${claudeMdPath}`
        : `CLAUDE.md not found at ${claudeMdPath}. Create it to store project-specific instructions.`
    }
  };
};

const configHandler = (_args: string[], _context?: CommandContext): CommandExecuteResponse => ({
  type: 'builtin',
  command: '/config',
  action: 'config',
  data: {
    message: 'Opening settings...'
  }
});

const newSessionHandler = (_args: string[], _context?: CommandContext): CommandExecuteResponse => ({
  type: 'builtin',
  command: '/new-session',
  action: 'new-session',
  data: {
    message: 'Creating new session...'
  }
});

const reloadHandler = (_args: string[], _context?: CommandContext): CommandExecuteResponse => {
  return {
    type: 'builtin',
    command: '/reload',
    action: 'reload',
    data: {
      message: 'Commands reloaded'
    }
  };
};

/**
 * /compact — manually compacts the current session's history.
 *
 * Required server-resolved context: `sessionId`, `db`, `agentProfile`, `llmProfile`.
 * The HTTP /execute route injects these from `context.sessionId` before
 * calling `commandRegistry.execute`. If anything is missing, we return
 * `data.ok=false` instead of throwing — the route still 200s and lets the
 * UI surface a structured error message.
 *
 * Optional args are joined as `customInstructions` for `generateSummary`.
 *
 * On success we emit `compaction_completed` so listening clients can refresh
 * their timeline without a full reload. The HTTP response also carries
 * the outcome so the issuing client can show immediate feedback even if
 * its WS connection happened to be a separate transport.
 */
const compactHandler: CommandHandler = async (args, context) => {
  const buildResponse = (data: Record<string, unknown>): CommandExecuteResponse => ({
    type: 'builtin',
    command: '/compact',
    action: 'compact',
    data,
  });

  if (!context?.sessionId || !context.db || !context.agentProfile || !context.llmProfile) {
    return buildResponse({
      ok: false,
      message: 'Cannot compact: missing session context. Open a session and try again.',
    });
  }

  const instructions = args.join(' ').trim() || undefined;
  const outcome = await forceCompact({
    db: context.db,
    sessionId: context.sessionId,
    agentProfile: context.agentProfile,
    llmProfile: context.llmProfile,
    customInstructions: instructions,
    source: 'manual',
    signal: context.abortSignal,
  });

  if (outcome.compacted) {
    console.log(`[Compaction] manual session=${context.sessionId} id=${outcome.compactionId} tokens=${outcome.tokensBefore}`);
    if (context.sendEvent) {
      context.sendEvent({
        type: 'compaction_completed',
        sessionId: context.sessionId,
        compactionId: outcome.compactionId!,
        tokensBefore: outcome.tokensBefore!,
      });
    }
    return buildResponse({
      ok: true,
      compactionId: outcome.compactionId,
      tokensBefore: outcome.tokensBefore,
      message: `Compacted ${outcome.tokensBefore} tokens.`,
    });
  }

  return buildResponse({
    ok: false,
    message: `Compaction not run: ${outcome.reason ?? 'unknown'}`,
    reason: outcome.reason,
  });
};

// ============================================
// Register Built-in Commands
// ============================================

export function registerBuiltinCommands(): void {
  const commands = [
    { command: '/clear', description: 'Clear conversation history', handler: clearHandler },
    { command: '/help', description: 'Show available commands', handler: helpHandler },
    { command: '/status', description: 'Show server status', handler: statusHandler },
    { command: '/model', description: 'Show current model info', handler: modelHandler },
    { command: '/cost', description: 'Show token usage', handler: costHandler },
    { command: '/memory', description: 'Show CLAUDE.md file info', handler: memoryHandler },
    { command: '/config', description: 'Open settings', handler: configHandler },
    { command: '/new-session', description: 'Create a new session', handler: newSessionHandler },
    { command: '/reload', description: 'Reload custom commands', handler: reloadHandler },
    { command: '/compact', description: 'Compact this session\'s history into a summary. Optional instructions guide the summary.', handler: compactHandler },
  ];

  for (const cmd of commands) {
    commandRegistry.register({
      command: cmd.command,
      description: cmd.description,
      handler: cmd.handler,
      source: 'builtin',
    });
  }

  console.log(`[CommandRegistry] Registered ${commandRegistry.size} built-in commands`);
}

// Auto-register on import
let registered = false;

export function ensureBuiltinCommandsRegistered(): void {
  if (!registered) {
    registerBuiltinCommands();
    registered = true;
  }
}
