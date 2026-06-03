import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type Database from 'better-sqlite3';
import { parseCommandArgs, substituteArgs } from '@earendil-works/pi-agent-core';
import type { ApiResponse } from '@zclaudia/shared/core/api';
import type { ServerMessage } from '@zclaudia/shared/wire/messages';
import type { CommandExecuteRequest, CommandExecuteResponse, SlashCommand } from '@zclaudia/shared/features/commands';
import { LOCAL_COMMANDS } from '@zclaudia/shared/features/commands';
import { commandRegistry, type CommandContext } from '../../application/commands/registry.js';
import { ensureBuiltinCommandsRegistered } from '../../application/commands/init.js';
import { resolveAgentForSession } from '../../domains/agent-profiles/agent-resolver.js';
import { SessionRepository } from '../../domains/sessions/repository.js';

// Ensure built-in commands are registered
ensureBuiltinCommandsRegistered();

export interface CommandsRoutesDeps {
  db: Database.Database;
  /**
   * Broadcast a wire-level event to all interested clients. Currently the
   * implementation in bootstrap broadcasts to all authenticated clients
   * (mirrors how plugin / heartbeat events are pushed). Pass-through is
   * intentional so the route does not need to know the transport.
   */
  broadcast: (event: ServerMessage) => void;
}

// Scan directory for custom command files (.md)
async function scanCommandsDirectory(dir: string, namespace: 'project' | 'user'): Promise<SlashCommand[]> {
  const commands: SlashCommand[] = [];

  try {
    if (!fs.existsSync(dir)) {
      return commands;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Recursively scan subdirectories
        const subCommands = await scanCommandsDirectory(fullPath, namespace);
        commands.push(...subCommands);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        // Parse markdown file
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const relativePath = path.relative(dir, fullPath);
          const commandName = '/' + relativePath.replace(/\.md$/, '').replace(/\\/g, '/');

          // Extract description from first line
          const firstLine = content.trim().split('\n')[0];
          const description = firstLine.replace(/^#+\s*/, '').trim();

          commands.push({
            command: commandName,
            description,
            source: 'custom',
            scope: namespace === 'project' ? 'project' : 'global',
            filePath: fullPath
          });
        } catch (err) {
          console.error(`Error parsing command file ${fullPath}:`, err);
        }
      }
    }
  } catch (err) {
    console.error(`Error scanning directory ${dir}:`, err);
  }

  return commands;
}

/**
 * Resolve effective args[] from the request body. Prefer rawArgs (parsed
 * with pi's shell-style quote handling) over the legacy pre-tokenized args[].
 * Empty rawArgs / undefined → fall back to args[] ?? [].
 */
function resolveArgs(body: CommandExecuteRequest): string[] {
  if (typeof body.rawArgs === 'string' && body.rawArgs.length > 0) {
    try {
      return parseCommandArgs(body.rawArgs);
    } catch (err) {
      // Malformed shell quoting → degrade gracefully to legacy args[] instead
      // of bubbling to a 500. Spec §5.5 risk #7.
      console.warn('[commands.execute] parseCommandArgs failed; falling back to args[]:', err);
      return body.args ?? [];
    }
  }
  return body.args ?? [];
}

export function createCommandsRoutes(deps?: CommandsRoutesDeps): Router {
  const router = Router();
  const sessionRepo = deps?.db ? new SessionRepository(deps.db) : null;

  // POST /api/commands/list - List all available commands
  router.post('/list', async (req: Request, res: Response) => {
    try {
      const { projectPath } = req.body as { projectPath?: string };
      const customCommands: SlashCommand[] = [];

      // Scan project-level commands
      if (projectPath) {
        const projectCommandsDir = path.join(projectPath, '.claude', 'commands');
        const projectCommands = await scanCommandsDirectory(projectCommandsDir, 'project');
        customCommands.push(...projectCommands);
      }

      // Scan user-level commands
      const userCommandsDir = path.join(os.homedir(), '.claude', 'commands');
      const userCommands = await scanCommandsDirectory(userCommandsDir, 'user');
      customCommands.push(...userCommands);

      const pluginCommands = commandRegistry.getCommandsBySource('plugin');

      res.json({
        success: true,
        data: {
          builtin: LOCAL_COMMANDS,
          custom: customCommands,
          plugin: pluginCommands,
          count: LOCAL_COMMANDS.length + customCommands.length + pluginCommands.length
        }
      } as ApiResponse<{ builtin: SlashCommand[]; custom: SlashCommand[]; plugin: SlashCommand[]; count: number }>);
    } catch (error) {
      console.error('Error listing commands:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to list commands' }
      });
    }
  });

  // POST /api/commands/execute - Execute a command
  router.post('/execute', async (req: Request, res: Response) => {
    try {
      const body = req.body as CommandExecuteRequest;
      const { commandName, commandPath, context = {} } = body;
      const args = resolveArgs(body);

      if (!commandName) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'commandName is required' }
        });
        return;
      }

      // Handle built-in commands via CommandRegistry
      if (commandRegistry.has(commandName)) {
        // Server-resolved context fields (NEVER come from the client body).
        // Resolved from sessionId when present. Handlers that don't need them
        // (e.g. /clear, /help) simply ignore the extra fields.
        const enriched: CommandContext = { ...(context as CommandContext) };
        if (deps?.db) enriched.db = deps.db;
        if (deps?.broadcast) enriched.sendEvent = deps.broadcast;

        if (context?.sessionId && sessionRepo && deps?.db) {
          const session = sessionRepo.findById(context.sessionId);
          if (session) {
            try {
              const { agent, llm } = resolveAgentForSession(deps.db, {
                explicitAgentId: session.agentProfileId,
                projectId: session.projectId,
              });
              enriched.agentProfile = agent;
              if (llm) enriched.llmProfile = llm;
            } catch (err) {
              // Stale agent / no agent configured — leave enriched fields unset
              // so the handler can fail soft with a structured message.
              console.warn(`[commands.execute] agent resolution failed for session ${context.sessionId}:`, err instanceof Error ? err.message : err);
            }
          }
        }

        const result = await commandRegistry.execute(commandName, args, enriched);
        res.json({ success: true, data: result } as ApiResponse<CommandExecuteResponse>);
        return;
      }

      // Handle custom commands
      if (!commandPath) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'commandPath is required for custom commands' }
        });
        return;
      }

      // Security: validate commandPath is within allowed directories
      const resolvedPath = path.resolve(commandPath);
      const userBase = path.resolve(path.join(os.homedir(), '.claude', 'commands'));
      const pluginsBase = path.resolve(path.join(os.homedir(), '.claude', 'plugins'));
      const projectBase = context?.projectPath
        ? path.resolve(path.join(context.projectPath, '.claude', 'commands'))
        : null;

      const isUnderBase = (base: string) => {
        const rel = path.relative(base, resolvedPath);
        return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
      };

      if (!(isUnderBase(userBase) || isUnderBase(pluginsBase) || (projectBase && isUnderBase(projectBase)))) {
        res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Command must be in .claude/commands or .claude/plugins directory' }
        });
        return;
      }

      // Read and process command file
      if (!fs.existsSync(commandPath)) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: `Command file not found: ${commandPath}` }
        });
        return;
      }

      const content = fs.readFileSync(commandPath, 'utf-8');

      const processedContent = substituteArgs(content, args);

      const result: CommandExecuteResponse = {
        type: 'custom',
        command: commandName,
        content: processedContent
      };

      res.json({ success: true, data: result } as ApiResponse<CommandExecuteResponse>);
    } catch (error) {
      console.error('Error executing command:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to execute command' }
      });
    }
  });

  return router;
}
