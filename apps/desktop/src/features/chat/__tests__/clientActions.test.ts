import { describe, expect, it } from 'vitest';
import {
  dispatchClientAction,
  hasClientAction,
  legacyAliasToHostActionName,
} from '../clientActions';
import '../clientActionDefinitions';

const baseCtx = (overrides: Partial<Parameters<typeof buildCtx>[0]> = {}) => buildCtx(overrides);

function buildCtx(
  overrides: {
    sessionId?: string;
    args?: string;
    messages?: string[];
    commands?: never[];
  } = {}
) {
  const messages: string[] = [];
  return {
    ctx: {
      sessionId: overrides.sessionId ?? 'session-1',
      args: overrides.args ?? '',
      addSystemMessage: (content: string) => {
        messages.push(content);
        overrides.messages?.push(content);
      },
      services: {
        commands: overrides.commands ?? [],
        isForcedPlanSession: false,
        switchWorktree: async () => {},
      },
    },
    messages,
  };
}

describe('desktop client action registry (URIP §12.4)', () => {
  it('registers every extracted composer branch', () => {
    for (const actionId of [
      'zc.help',
      'zc.context',
      'zc.worktree',
      'zc.create-worktree',
      'zc.new-cli-session',
      'zc.goal',
      'zc.create-task',
      'zc.status',
      'zc.pause',
      'zc.resume',
    ]) {
      expect(hasClientAction(actionId), actionId).toBe(true);
    }
  });

  it('maps legacy aliases to canonical host action names (§17.3)', () => {
    expect(legacyAliasToHostActionName('help')).toBe('help');
    expect(legacyAliasToHostActionName('/help')).toBe('help');
    expect(legacyAliasToHostActionName('reset-cli-session')).toBe('new-cli-session');
    expect(legacyAliasToHostActionName('review')).toBeUndefined();
  });

  it('dispatches zc.help through the registry (ex-/help branch)', async () => {
    const { ctx, messages } = buildCtx({
      commands: [
        {
          command: '/zc:help',
          name: 'help',
          description: 'Show available commands',
          source: 'local',
        } as never,
      ],
    });
    const handled = await dispatchClientAction('zc.help', ctx);
    expect(handled).toBe(true);
    expect(messages.join('\n')).toContain('Built-in Commands');
  });

  it('usage text for zc.worktree when no args are given', async () => {
    const { ctx, messages } = baseCtx();
    await dispatchClientAction('zc.worktree', ctx);
    expect(messages.join('\n')).toContain('Current worktree');
  });

  it('returns false for unregistered action IDs instead of guessing', async () => {
    const { ctx } = baseCtx();
    expect(await dispatchClientAction('zc.does-not-exist', ctx)).toBe(false);
  });
});
