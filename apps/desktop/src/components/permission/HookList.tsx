import { useState } from 'react';
import { parseToolRule, type UserHookDefinition } from '@zclaudia/shared';

interface HookListProps {
  hooks: UserHookDefinition[];
  onChange: (hooks: UserHookDefinition[]) => void;
}

export function HookList({ hooks, onChange }: HookListProps) {
  const [matcherErrors, setMatcherErrors] = useState<Record<number, string>>({});

  const update = (i: number, patch: Partial<UserHookDefinition>) => {
    onChange(hooks.map((h, j) => (j === i ? { ...h, ...patch } : h)));
  };

  const setMatcher = (i: number, value: string) => {
    if (!value.trim()) {
      setMatcherErrors((e) => ({ ...e, [i]: '' }));
      const { matcher: _removed, ...rest } = hooks[i];
      onChange(hooks.map((h, j) => (j === i ? (rest as UserHookDefinition) : h)));
      return;
    }
    const parsed = parseToolRule(value);
    if (!parsed.ok) {
      setMatcherErrors((e) => ({ ...e, [i]: parsed.error }));
      return; // invalid matcher stays local — not propagated upward
    }
    setMatcherErrors((e) => ({ ...e, [i]: '' }));
    update(i, { matcher: value });
  };

  const toggleEnabled = (i: number) => {
    const hook = hooks[i];
    const currentlyEnabled = hook.enabled !== false;
    if (currentlyEnabled) {
      // disable it
      update(i, { enabled: false });
    } else {
      // re-enable it: remove the enabled:false by spreading enabled:true
      update(i, { enabled: true });
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-amber-600">
        Hooks run arbitrary shell commands with the server&apos;s privileges.
      </p>
      {hooks.map((hook, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 p-2 bg-secondary rounded">
          <select
            value={hook.event}
            onChange={(e) => update(i, { event: e.target.value as UserHookDefinition['event'] })}
            aria-label="hook event"
            className="px-2 py-1 bg-background border border-border rounded text-sm"
          >
            <option value="PreToolUse">PreToolUse</option>
            <option value="PostToolUse">PostToolUse</option>
          </select>
          <div className="flex-1 min-w-[140px]">
            <input
              defaultValue={hook.matcher ?? ''}
              onChange={(e) => setMatcher(i, e.target.value)}
              placeholder="Bash(git *)"
              aria-label="hook matcher"
              className="w-full px-2 py-1 bg-background border border-border rounded text-sm font-mono"
            />
            {matcherErrors[i] && <p className="text-xs text-destructive">{matcherErrors[i]}</p>}
          </div>
          <input
            value={hook.command}
            onChange={(e) => update(i, { command: e.target.value })}
            placeholder="./scripts/lint-gate.sh"
            aria-label="hook command"
            className="flex-[2] min-w-[180px] px-2 py-1 bg-background border border-border rounded text-sm font-mono"
          />
          <input
            type="number"
            value={Math.round((hook.timeoutMs ?? 10_000) / 1000)}
            onChange={(e) =>
              update(i, { timeoutMs: Math.max(1, Number(e.target.value) || 10) * 1000 })
            }
            aria-label="hook timeout seconds"
            title="Timeout (seconds)"
            className="w-16 px-2 py-1 bg-background border border-border rounded text-sm"
          />
          <input
            type="checkbox"
            checked={hook.enabled !== false}
            onChange={() => toggleEnabled(i)}
            aria-label="hook enabled"
          />
          <button
            aria-label="remove hook"
            onClick={() => onChange(hooks.filter((_, j) => j !== i))}
            className="text-muted-foreground hover:text-destructive text-xs"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        onClick={() => onChange([...hooks, { event: 'PreToolUse', command: '' }])}
        className="text-sm text-primary hover:underline"
      >
        + Add hook
      </button>
    </div>
  );
}
