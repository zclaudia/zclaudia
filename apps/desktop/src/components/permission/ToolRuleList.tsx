import { useState } from 'react';
import type { AgentPermissionRule } from '@zclaudia/shared';
import { parseToolRule, formatToolRule } from '@zclaudia/shared';

const GROUPS: Array<{ action: AgentPermissionRule['action']; label: string; hint: string }> = [
  { action: 'approve', label: 'Allow', hint: 'Auto-approved without prompting' },
  { action: 'escalate', label: 'Ask', hint: 'Always prompts for approval' },
  { action: 'deny', label: 'Deny', hint: 'Auto-denied' },
];

interface ToolRuleListProps {
  rules: AgentPermissionRule[];
  onChange: (rules: AgentPermissionRule[]) => void;
}

export function ToolRuleList({ rules, onChange }: ToolRuleListProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = (action: AgentPermissionRule['action']) => {
    const text = (drafts[action] ?? '').trim();
    if (!text) return;
    const parsed = parseToolRule(text);
    if (!parsed.ok) {
      setErrors((e) => ({ ...e, [action]: parsed.error }));
      return;
    }
    const rule: AgentPermissionRule = {
      toolName: parsed.rule.toolName,
      ...(parsed.rule.pattern ? { pattern: parsed.rule.pattern } : {}),
      action,
    };
    const exists = rules.some(
      (r) => r.toolName === rule.toolName && (r.pattern ?? null) === (rule.pattern ?? null) && r.action === action,
    );
    if (!exists) onChange([...rules, rule]);
    setDrafts((d) => ({ ...d, [action]: '' }));
    setErrors((e) => ({ ...e, [action]: '' }));
  };

  const advanced = rules.filter((r) => r.action === 'continue');

  return (
    <div className="space-y-3">
      {GROUPS.map(({ action, label, hint }) => {
        const group = rules.filter((r) => r.action === action);
        return (
          <div key={action}>
            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-xs font-medium">{label}</span>
              <span className="text-[10px] text-muted-foreground">{hint}</span>
            </div>
            <div className="space-y-1">
              {group.map((rule, i) => (
                <div
                  key={`${rule.toolName}-${rule.pattern ?? ''}-${i}`}
                  className="flex items-center justify-between px-2 py-1 bg-secondary rounded text-xs font-mono"
                >
                  <span>{formatToolRule(rule)}</span>
                  <button
                    aria-label="remove rule"
                    onClick={() => onChange(rules.filter((r) => r !== rule))}
                    className="text-muted-foreground hover:text-destructive text-xs ml-2 flex-shrink-0"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <input
                value={drafts[action] ?? ''}
                onChange={(e) => setDrafts((d) => ({ ...d, [action]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit(action);
                }}
                placeholder="Bash(git *)"
                className="w-full px-2 py-1 bg-background border border-border rounded text-xs font-mono focus:outline-none focus:border-primary"
              />
              {errors[action] && <p className="text-[10px] text-destructive">{errors[action]}</p>}
            </div>
          </div>
        );
      })}
      {advanced.length > 0 && (
        <div>
          <span className="text-xs font-medium">Advanced</span>
          {advanced.map((rule, i) => (
            <div key={i} className="px-2 py-1 text-xs font-mono text-muted-foreground">
              {formatToolRule(rule)} <span className="text-[10px]">(continue)</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
