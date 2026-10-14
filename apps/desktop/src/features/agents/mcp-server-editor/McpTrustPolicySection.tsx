import { EditorSection, FieldLabel } from '../ui/EditorSection';
import { FIELD_CLASS } from '../../../components/ui/Input';
import type { McpRiskAction, McpServerTrustLevel } from '@zclaudia/shared/core/mcp';

const RISK_ACTION_OPTIONS: Array<{ value: McpRiskAction | ''; label: string }> = [
  { value: '', label: 'Use default' },
  { value: 'auto-approve', label: 'Auto approve' },
  { value: 'ask', label: 'Ask' },
  { value: 'deny', label: 'Deny' },
];

/**
 * "Trust Policy" section of the MCP server editor: trust level, default risk
 * action, the read-only-hint toggle, and the per-severity risk action
 * overrides. Purely presentational — the parent owns the trustPolicy draft.
 */
export function McpTrustPolicySection({
  trustLevel,
  onTrustLevelChange,
  trustReadOnlyHint,
  onTrustReadOnlyHintChange,
  defaultRiskAction,
  onDefaultRiskActionChange,
  riskActions,
  onRiskActionChange,
}: {
  trustLevel: McpServerTrustLevel;
  onTrustLevelChange: (level: McpServerTrustLevel) => void;
  trustReadOnlyHint: boolean;
  onTrustReadOnlyHintChange: (value: boolean) => void;
  defaultRiskAction: McpRiskAction;
  onDefaultRiskActionChange: (action: McpRiskAction) => void;
  riskActions: Partial<Record<'low' | 'medium' | 'high', McpRiskAction>>;
  onRiskActionChange: (level: 'low' | 'medium' | 'high', action: McpRiskAction | '') => void;
}) {
  return (
    <EditorSection
      title="Trust Policy"
      description="Controls how self-declared MCP read-only hints and risk levels affect permission prompts."
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <FieldLabel htmlFor="mcp-trust-level">Trust Level</FieldLabel>
          <select
            id="mcp-trust-level"
            aria-label="Trust Level"
            value={trustLevel}
            onChange={e => onTrustLevelChange(e.target.value as McpServerTrustLevel)}
            className={FIELD_CLASS}
          >
            <option value="untrusted">Untrusted</option>
            <option value="trusted-readonly">Trusted read-only</option>
            <option value="trusted">Trusted</option>
          </select>
        </div>
        <div>
          <FieldLabel htmlFor="mcp-default-risk-action">Default risk action</FieldLabel>
          <select
            id="mcp-default-risk-action"
            aria-label="Default risk action"
            value={defaultRiskAction}
            onChange={e => onDefaultRiskActionChange(e.target.value as McpRiskAction)}
            className={FIELD_CLASS}
          >
            {RISK_ACTION_OPTIONS.filter(opt => opt.value).map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground max-md:py-2">
        <input
          type="checkbox"
          checked={trustReadOnlyHint}
          onChange={e => onTrustReadOnlyHintChange(e.target.checked)}
          className="rounded border-border bg-secondary/50"
        />
        Trust read-only hints
      </label>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        {(['low', 'medium', 'high'] as const).map(level => (
          <div key={level}>
            <FieldLabel htmlFor={`mcp-${level}-risk-action`}>
              {`${level[0].toUpperCase()}${level.slice(1)}`} risk action
            </FieldLabel>
            <select
              id={`mcp-${level}-risk-action`}
              aria-label={`${level[0].toUpperCase()}${level.slice(1)} risk action`}
              value={riskActions[level] ?? ''}
              onChange={e => onRiskActionChange(level, e.target.value as McpRiskAction | '')}
              className={`${FIELD_CLASS} text-xs`}
            >
              {RISK_ACTION_OPTIONS.map(opt => (
                <option key={opt.value || 'default'} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </EditorSection>
  );
}
