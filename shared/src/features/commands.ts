// Slash Command Types

export type SlashCommandSource = 'local' | 'provider' | 'custom' | 'plugin';
export type SlashCommandScope = 'global' | 'project';

export interface SlashCommand {
  command: string;        // e.g., '/clear', '/help', '/project:my-command', '/commit-commands:commit'
  description: string;    // Displayed in autocomplete
  source: SlashCommandSource;  // 'local' = frontend, 'provider' = runtime built-in, 'custom' = user-defined, 'plugin' = plugin-supplied
  scope?: SlashCommandScope;   // For custom commands: 'global' or 'project'
  filePath?: string;      // For custom/plugin commands: path to the .md file
}

// Local UI commands (always available, handled by frontend)
export const LOCAL_COMMANDS: SlashCommand[] = [
  { command: '/clear', description: 'Clear chat history', source: 'local' },
  { command: '/help', description: 'Show help information', source: 'local' },
  { command: '/model', description: 'Show current model/provider info', source: 'local' },
  { command: '/status', description: 'Show system status', source: 'local' },
  { command: '/cost', description: 'Show token usage', source: 'local' },
  { command: '/context', description: 'Show context window usage', source: 'local' },
  { command: '/config', description: 'Open settings', source: 'local' },
  { command: '/new-session', description: 'Create new session', source: 'local' },
  { command: '/reload', description: 'Reload custom commands', source: 'local' },
  { command: '/worktree', description: 'Switch to or view current worktree', source: 'local' },
  { command: '/create-worktree', description: 'Create a new git worktree and switch to it', source: 'local' },
];

// Runtime pass-through commands forwarded to the active agent runtime.
// Empty until pi-agent advertises a built-in command set.
export const CLI_COMMANDS: SlashCommand[] = [];

// Command Execution Types

export type CommandType = 'builtin' | 'custom';

export interface CommandExecuteRequest {
  commandName: string;
  commandPath?: string;   // For custom commands: path to .md file
  args?: string[];
  /**
   * Raw unparsed args string (e.g. `"focus on 'auth refactor'"`). When
   * present, the server tokenizes via pi `parseCommandArgs` (shell-style
   * single + double quotes). When absent or empty, falls back to `args`.
   *
   * Clients should send `rawArgs` for new code; `args` remains accepted
   * for older desktop builds.
   */
  rawArgs?: string;
  context?: {
    projectPath?: string;
    projectName?: string;
    sessionId?: string;
    provider?: string;
    model?: string;
    tokenUsage?: { used: number; total: number };
  };
}

export interface CommandExecuteResponse {
  type: CommandType;
  command: string;
  action?: string;        // For builtin: 'clear', 'help', 'model', 'cost', 'status', etc.
  data?: Record<string, unknown>;
  content?: string;       // For custom: processed command content
  error?: string;
}
