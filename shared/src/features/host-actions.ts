/**
 * Canonical ZClaudia host actions (URIP design doc §12.4).
 *
 * These are the desktop-composer commands that existed as hard-coded name
 * branches in `useCommandHandler`. Each is now a registered host action
 * addressed as `/zc:<name>`:
 * - the server lists it in the session invocable catalog (executionLocus
 *   `client`, so no provider turn and no server body is involved);
 * - the desktop owns the only execution table (client action IDs below).
 *
 * The unqualified legacy triggers (e.g. `/help`) remain as compatibility
 * aliases during the documented deprecation window (§17.3); `/zc:` is the
 * canonical namespace.
 */

export interface HostActionSpec {
  /** Canonical name after `/zc:` — unique by construction. */
  name: string;
  /** Desktop-side registered action ID. */
  clientActionId: string;
  label: string;
  description: string;
  argumentHint?: string;
  /** Legacy unqualified aliases kept during the migration window. */
  aliases: string[];
}

export const DESKTOP_HOST_ACTIONS: HostActionSpec[] = [
  {
    name: 'help',
    clientActionId: 'zc.help',
    label: 'Help',
    description: 'Show available commands',
    aliases: ['/help'],
  },
  {
    name: 'context',
    clientActionId: 'zc.context',
    label: 'Context Usage',
    description: 'Show context window usage for this session',
    aliases: ['/context'],
  },
  {
    name: 'worktree',
    clientActionId: 'zc.worktree',
    label: 'Worktree',
    description: 'View or switch the session worktree',
    argumentHint: '[path|reset]',
    aliases: ['/worktree'],
  },
  {
    name: 'create-worktree',
    clientActionId: 'zc.create-worktree',
    label: 'Create Worktree',
    description: 'Create a new worktree and switch to it',
    argumentHint: '[branch] [path]',
    aliases: ['/create-worktree'],
  },
  {
    name: 'new-cli-session',
    clientActionId: 'zc.new-cli-session',
    label: 'New CLI Session',
    description: 'Reset the underlying provider session',
    aliases: ['/new-cli-session', '/reset-cli-session'],
  },
  {
    name: 'goal',
    clientActionId: 'zc.goal',
    label: 'Goal',
    description: 'Set or control an autonomous goal',
    argumentHint: '<objective>|pause|resume|clear',
    aliases: ['/goal'],
  },
  {
    name: 'create-task',
    clientActionId: 'zc.create-task',
    label: 'Create Task',
    description: 'Create a supervision task (supervisor session)',
    argumentHint: '<title>',
    aliases: ['/create-task'],
  },
  {
    name: 'status',
    clientActionId: 'zc.status',
    label: 'Supervisor Status',
    description: 'Show supervision agent and tasks (supervisor session)',
    aliases: ['/status'],
  },
  {
    name: 'pause',
    clientActionId: 'zc.pause',
    label: 'Pause Supervisor',
    description: 'Pause the supervision agent (supervisor session)',
    aliases: ['/pause'],
  },
  {
    name: 'resume',
    clientActionId: 'zc.resume',
    label: 'Resume Supervisor',
    description: 'Resume the supervision agent (supervisor session)',
    aliases: ['/resume'],
  },
];
