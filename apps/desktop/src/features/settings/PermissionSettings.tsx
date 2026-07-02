import { useState, useEffect, useCallback } from 'react';
import { getAgentConfig, updateAgentConfig } from '../../services/api/servers';
import { listAllWorkflows } from '../../features/workflows/api';
import * as providersApi from '../../services/api/llm-profiles';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import { useLlmProfileMetaStore } from '../../stores/llmProfileMetaStore';
import { useServerStore } from '../../stores/serverStore';
import { Select } from '../../components/ui/Select';
import type {
  UnifiedPermissionPolicy,
  CategoryAction,
  PermissionCategory,
  GlobalGuards,
  AIReviewConfig,
  Workflow,
  UserHookDefinition,
} from '@zclaudia/shared';
import { DEFAULT_UNIFIED_POLICY, normalizeToUnifiedPolicy } from '@zclaudia/shared';
import { ToolRuleList } from '../../components/permission/ToolRuleList';
import { HookList } from '../../components/permission/HookList';
import { SettingsGroup, SettingsRow } from './ui/SettingsGroup';
import { Toggle } from '../../components/ui/Toggle';

const PERMISSION_FALLBACK_TEMPLATE_ID = 'permission-escalation-default';

const CATEGORY_LABELS: Record<PermissionCategory, { label: string; description: string }> = {
  fileRead: { label: 'File Read', description: 'Read, Glob, Grep, WebFetch, WebSearch' },
  fileWrite: { label: 'File Write', description: 'Write, Edit, NotebookEdit' },
  shellSafe: { label: 'Shell (safe)', description: 'Bash commands (non-network, non-destructive)' },
  networkOps: { label: 'Network Ops', description: 'curl, wget, ssh, git push/pull, npm publish' },
  destructiveOps: { label: 'Destructive Ops', description: 'rm -rf, sudo, mkfs, dd, format' },
  userQuestions: {
    label: 'User Questions',
    description: 'AskUserQuestion (always requires approval)',
  },
};

const CATEGORY_ORDER: PermissionCategory[] = [
  'fileRead',
  'fileWrite',
  'shellSafe',
  'networkOps',
  'destructiveOps',
  'userQuestions',
];

const ACTION_OPTIONS: Array<{ value: CategoryAction; label: string }> = [
  { value: 'auto-approve', label: 'Auto-approve' },
  { value: 'ask', label: 'Ask' },
  { value: 'block', label: 'Block' },
];

function CategoryRow({
  category,
  value,
  onChange,
  disabled,
}: {
  category: PermissionCategory;
  value: CategoryAction;
  onChange: (action: CategoryAction) => void;
  disabled?: boolean;
}) {
  const info = CATEGORY_LABELS[category];
  const isLocked = category === 'userQuestions';
  return (
    <SettingsRow
      title={info.label}
      description={info.description}
      control={
        <Select<CategoryAction>
          value={isLocked ? 'ask' : value}
          onChange={onChange}
          options={ACTION_OPTIONS}
          disabled={disabled || isLocked}
          title={isLocked ? 'User questions always require approval' : undefined}
          triggerClassName="min-w-[120px]"
        />
      }
    />
  );
}

function AIReviewProviderSelector({
  value,
  onChange,
  disabled,
}: {
  value?: string;
  onChange: (id: string | undefined) => void;
  disabled: boolean;
}) {
  const activeServerId = useServerStore(s => s.activeServerId);
  const storeProviders = useLlmProfileMetaStore(s => s.getProviders(activeServerId));
  const [providers, setProviders] = useState<LlmProfileConfig[]>(storeProviders);
  const [eligibleProviderIds, setEligibleProviderIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (storeProviders.length > 0) {
      setProviders(storeProviders);
      return;
    }

    let cancelled = false;
    void providersApi
      .listLlmProfiles()
      .then(loadedProviders => {
        if (cancelled) return;
        setProviders(loadedProviders);
        useLlmProfileMetaStore.getState().setProviders(loadedProviders, activeServerId);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [activeServerId, storeProviders]);

  useEffect(() => {
    let cancelled = false;

    const loadCapabilities = async () => {
      const results = await Promise.all(
        providers.map(async provider => {
          try {
            const capabilities = await providersApi.getProviderCapabilities(provider.id);
            return [provider.id, capabilities.supportsAIReview === true] as const;
          } catch {
            return [provider.id, false] as const;
          }
        })
      );

      if (!cancelled) {
        setEligibleProviderIds(Object.fromEntries(results));
      }
    };

    void loadCapabilities();
    return () => {
      cancelled = true;
    };
  }, [providers]);

  const eligibleProviders = providers.filter(provider => eligibleProviderIds[provider.id] === true);
  const selectedProvider = value ? providers.find(provider => provider.id === value) : undefined;
  const selectedProviderSupported = selectedProvider
    ? eligibleProviderIds[selectedProvider.id] === true
    : true;

  return (
    <SettingsRow
      align="start"
      title="Review provider"
      description="Only providers that support AI review are shown here"
      control={
        <div className="flex flex-col items-end gap-1">
          <Select
            value={value || ''}
            onChange={next => onChange(next || undefined)}
            disabled={disabled}
            triggerClassName="max-w-[220px] min-w-[180px]"
            options={[
              { value: '', label: 'Session default' },
              ...(selectedProvider && !selectedProviderSupported
                ? [
                    {
                      value: selectedProvider.id,
                      label: `${selectedProvider.name} (${selectedProvider.providerType}) - unsupported`,
                    },
                  ]
                : []),
              ...eligibleProviders.map(provider => ({
                value: provider.id,
                label: `${provider.name} (${provider.providerType})`,
              })),
            ]}
          />
          {selectedProvider && !selectedProviderSupported && (
            <p className="text-[10px] text-amber-600">
              The selected provider does not support AI review and cannot be used here.
            </p>
          )}
        </div>
      }
    />
  );
}

export function PermissionSettings() {
  const [policy, setPolicy] = useState<UnifiedPermissionPolicy>(DEFAULT_UNIFIED_POLICY);
  const [workflowOptions, setWorkflowOptions] = useState<Workflow[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hookList, setHookList] = useState<UserHookDefinition[]>([]);

  const loadPolicy = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [config, workflows] = await Promise.all([getAgentConfig(), listAllWorkflows()]);

      setSelectedWorkflowId(config.permissionWorkflowOverrideId ?? '');
      setWorkflowOptions(
        workflows.filter(
          workflow =>
            workflow.status === 'active' &&
            !workflow.isSystem &&
            workflow.templateId !== PERMISSION_FALLBACK_TEMPLATE_ID
        )
      );

      if (config.permissionPolicy) {
        const raw = JSON.parse(config.permissionPolicy);
        setPolicy(normalizeToUnifiedPolicy(raw));
      } else {
        setPolicy(DEFAULT_UNIFIED_POLICY);
      }

      if (config.hooks) {
        try {
          const rawHooks = JSON.parse(config.hooks);
          if (Array.isArray(rawHooks)) {
            setHookList(rawHooks as UserHookDefinition[]);
          } else {
            setHookList([]);
          }
        } catch {
          setHookList([]);
        }
      } else {
        setHookList([]);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPolicy();
  }, [loadPolicy]);

  const savePolicy = useCallback(async (updated: UnifiedPermissionPolicy) => {
    setSaving(true);
    try {
      await updateAgentConfig({ permissionPolicy: JSON.stringify(updated) });
      setPolicy(updated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, []);

  const updatePermissionWorkflowOverride = useCallback(async (workflowId: string) => {
    setSaving(true);
    setError(null);
    try {
      const config = await updateAgentConfig({
        permissionWorkflowOverrideId: workflowId || null,
      });
      setSelectedWorkflowId(config.permissionWorkflowOverrideId ?? '');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, []);

  const updateCategory = useCallback(
    (category: PermissionCategory, action: CategoryAction) => {
      const updated = {
        ...policy,
        profile: { ...policy.profile, [category]: action },
      };
      savePolicy(updated);
    },
    [policy, savePolicy]
  );

  const updateGuard = useCallback(
    (key: keyof GlobalGuards, value: boolean) => {
      const updated = {
        ...policy,
        globalGuards: { ...policy.globalGuards, [key]: value },
      };
      savePolicy(updated);
    },
    [policy, savePolicy]
  );

  const updateAIReview = useCallback(
    (patch: Partial<AIReviewConfig>) => {
      const updated = {
        ...policy,
        aiReview: { ...policy.aiReview, ...patch },
      };
      savePolicy(updated);
    },
    [policy, savePolicy]
  );

  const toggleEnabled = useCallback(() => {
    const updated = { ...policy, enabled: !policy.enabled };
    savePolicy(updated);
  }, [policy, savePolicy]);

  const resetDefaults = useCallback(() => {
    savePolicy(DEFAULT_UNIFIED_POLICY);
  }, [savePolicy]);

  const saveHooks = useCallback(async (next: UserHookDefinition[]) => {
    setSaving(true);
    try {
      await updateAgentConfig({ hooks: next.length > 0 ? JSON.stringify(next) : null });
      setHookList(next);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save hooks');
    } finally {
      setSaving(false);
    }
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="p-3 bg-secondary/50 rounded-lg text-sm text-muted-foreground">
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Master toggle (standalone, label-less card) */}
      <SettingsGroup>
        <SettingsRow
          align="start"
          title="Auto-approve tools"
          description={
            <>
              Automatically approve or block tool calls based on category rules
              {!policy.enabled && (
                <span className="mt-2 block italic text-muted-foreground/70">
                  When disabled, all tool calls require manual approval.
                </span>
              )}
            </>
          }
          control={
            <Toggle
              checked={policy.enabled}
              onChange={toggleEnabled}
              disabled={saving}
              aria-label="Auto-approve tools"
            />
          }
        />
      </SettingsGroup>

      {policy.enabled && (
        <SettingsGroup label="Permission categories">
          {CATEGORY_ORDER.map(cat => (
            <CategoryRow
              key={cat}
              category={cat}
              value={policy.profile[cat]}
              onChange={action => updateCategory(cat, action)}
              disabled={saving}
            />
          ))}
        </SettingsGroup>
      )}

      {policy.enabled && (
        <SettingsGroup label="Tool rules">
          <div className="space-y-3 p-4">
            <p className="text-xs text-muted-foreground">
              Fine-grained per-tool rules like <code className="font-mono">Bash(git *)</code>. Deny
              outranks guards; Allow cannot bypass sensitive-file protection.
            </p>
            <ToolRuleList
              rules={policy.customRules}
              onChange={customRules => savePolicy({ ...policy, customRules })}
            />
          </div>
        </SettingsGroup>
      )}

      <SettingsGroup label="Hooks">
        <div className="space-y-3 p-4">
          <p className="text-xs text-muted-foreground">
            Shell commands that run before/after tool calls. Exit code 2 from a PreToolUse hook
            blocks the call.
          </p>
          <HookList
            hooks={hookList}
            onChange={next => {
              void saveHooks(next);
            }}
          />
        </div>
      </SettingsGroup>

      {policy.enabled && (
        <SettingsGroup label="AI review">
          <SettingsRow
            align="start"
            title="Enable AI review"
            description="When a blacklisted command times out, AI reviews it before denying"
            control={
              <Toggle
                checked={policy.aiReview.enabled}
                onChange={() => updateAIReview({ enabled: !policy.aiReview.enabled })}
                disabled={saving}
                aria-label="Enable AI review"
              />
            }
          />
          {policy.aiReview.enabled && (
            <>
              <SettingsRow
                title="Review timeout"
                description="Seconds before triggering AI review"
                control={
                  <input
                    type="number"
                    min={10}
                    max={300}
                    defaultValue={policy.aiReview.timeoutBeforeReview}
                    onBlur={e =>
                      updateAIReview({
                        timeoutBeforeReview: Math.max(10, parseInt(e.target.value) || 60),
                      })
                    }
                    disabled={saving}
                    className="h-6 w-16 rounded-full border border-border bg-background px-2 text-right text-[11px] focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                }
              />
              <SettingsRow
                title="Confidence threshold"
                description="AI must be this confident to auto-approve (%)"
                control={
                  <input
                    type="number"
                    min={50}
                    max={100}
                    defaultValue={Math.round(policy.aiReview.confidenceThreshold * 100)}
                    onBlur={e =>
                      updateAIReview({
                        confidenceThreshold: Math.max(
                          0.5,
                          Math.min(1, (parseInt(e.target.value) || 80) / 100)
                        ),
                      })
                    }
                    disabled={saving}
                    className="h-6 w-16 rounded-full border border-border bg-background px-2 text-right text-[11px] focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                }
              />
              <SettingsRow
                title="Rate limit"
                description="Max auto-approvals per minute"
                control={
                  <input
                    type="number"
                    min={1}
                    max={60}
                    defaultValue={policy.aiReview.maxAutoApprovalsPerMinute}
                    onBlur={e =>
                      updateAIReview({
                        maxAutoApprovalsPerMinute: Math.max(1, parseInt(e.target.value) || 10),
                      })
                    }
                    disabled={saving}
                    className="h-6 w-16 rounded-full border border-border bg-background px-2 text-right text-[11px] focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                }
              />
              <AIReviewProviderSelector
                value={policy.aiReview.analysisLlmProfileId}
                onChange={id => updateAIReview({ analysisLlmProfileId: id })}
                disabled={saving}
              />
            </>
          )}
        </SettingsGroup>
      )}

      <SettingsGroup label="Permission workflow">
        <SettingsRow
          align="start"
          title="Global override"
          description="Optional workflow override. If unavailable, the system fallback workflow is still used."
          control={
            <Select
              value={selectedWorkflowId}
              onChange={next => {
                void updatePermissionWorkflowOverride(next);
              }}
              disabled={saving || loading}
              size="md"
              triggerClassName="min-w-[220px]"
              options={[
                { value: '', label: 'System fallback only' },
                ...workflowOptions.map(workflow => ({
                  value: workflow.id,
                  label: workflow.projectId
                    ? `[Project] ${workflow.name}`
                    : `[Global] ${workflow.name}`,
                })),
              ]}
            />
          }
        >
          <p className="text-[10px] text-muted-foreground">
            Resolution order: project override, then global override, then immutable system
            fallback.
          </p>
        </SettingsRow>
      </SettingsGroup>

      {policy.enabled && (
        <SettingsGroup label="Safety guards">
          <SettingsRow
            align="start"
            title="Protect sensitive files"
            description=".env, .ssh, credentials, *.key, *.pem — requires approval even if category is auto-approve"
            control={
              <input
                type="checkbox"
                checked={policy.globalGuards.blockSensitiveFiles}
                onChange={e => updateGuard('blockSensitiveFiles', e.target.checked)}
                disabled={saving}
                className="mt-0.5 rounded-md border-border"
              />
            }
          />
          <SettingsRow
            align="start"
            title="Enforce workspace scope"
            description="Block file/bash operations targeting paths outside the project directory"
            control={
              <input
                type="checkbox"
                checked={policy.globalGuards.blockOutsideWorkspace}
                onChange={e => updateGuard('blockOutsideWorkspace', e.target.checked)}
                disabled={saving}
                className="mt-0.5 rounded-md border-border"
              />
            }
          />
        </SettingsGroup>
      )}

      {policy.enabled && (
        <button
          onClick={resetDefaults}
          disabled={saving}
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          Reset to defaults
        </button>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
