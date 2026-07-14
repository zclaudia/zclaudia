import { type Router, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import type { ApiResponse } from '@zclaudia/shared/core/api';
import type { SlashCommand } from '@zclaudia/shared/features/commands';
import { LOCAL_COMMANDS, CLI_COMMANDS } from '@zclaudia/shared/features/commands';
import { scanCustomCommands } from '../../utils/command-scanner.js';
import { createExecutionEnv } from '../../infra/execution-env.js';
import { commandRegistry } from '../../application/commands/registry.js';

function deduplicateCommands(commands: SlashCommand[]): SlashCommand[] {
  const seen = new Set<string>();
  return commands.filter(cmd => {
    if (seen.has(cmd.command)) return false;
    seen.add(cmd.command);
    return true;
  });
}

async function getZClaudiaCommands(projectRoot?: string): Promise<SlashCommand[]> {
  const env = createExecutionEnv(projectRoot ?? process.cwd());
  const customCommands = await scanCustomCommands(env, { projectRoot });
  const pluginCommands = commandRegistry.getCommandsBySource('plugin');
  return deduplicateCommands([
    ...LOCAL_COMMANDS,
    ...CLI_COMMANDS,
    ...pluginCommands,
    ...customCommands,
  ]);
}

export function mountCommandRoutes(router: Router, db: Database.Database): void {
  router.get('/:id/commands', async (req: Request, res: Response) => {
    const row = db.prepare('SELECT id FROM llm_profiles WHERE id = ?').get(req.params.id) as
      | { id: string }
      | undefined;

    if (!row) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Runtime config not found' },
      });
      return;
    }

    const projectRoot = req.query.projectRoot as string | undefined;
    res.json({ success: true, data: await getZClaudiaCommands(projectRoot) } as ApiResponse<
      SlashCommand[]
    >);
  });

  router.get('/type/:type/commands', async (req: Request, res: Response) => {
    if (
      req.params.type !== 'zclaudia' &&
      req.params.type !== 'claude' &&
      req.params.type !== 'cursor' &&
      req.params.type !== 'codex'
    ) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Runtime type not found' },
      });
      return;
    }

    const projectRoot = req.query.projectRoot as string | undefined;
    res.json({ success: true, data: await getZClaudiaCommands(projectRoot) } as ApiResponse<
      SlashCommand[]
    >);
  });
}
