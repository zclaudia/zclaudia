import type { ProfileConfigDescriptor } from '@zclaudia/shared/core/profile-config-descriptor';
import type {
  SkillExecutionMode,
  SkillExecutionSelection,
  SkillSelection,
  SkillSource,
} from '@zclaudia/shared/core/skills';
import { skillRefKey } from '@zclaudia/shared/core/skills';
import type { WorkspaceSkillInfo } from '../../../services/api';
import { CapabilityNote } from './CapabilityNote';
import { skillRefFor } from './derive';
import type { SkillDefaultModeOption, SkillForkToolPolicyOption } from './useSkillSelection';

type SkillExecutionOverride = NonNullable<SkillExecutionSelection['overrides']>[number];

/**
 * "Skills" sub-panel of the profile editor's Capabilities tab: per-source
 * enable toggles and, for each discovered skill, visibility/pinning plus the
 * execution-policy overrides — or a read-only note when the runtime sources
 * skills externally.
 *
 * Purely presentational — selection and execution-override state live in the
 * parent's `useSkillSelection` hook; every mutation flows back through the
 * passed callbacks.
 */
export function SkillsPanel({
  descriptor,
  skillCatalog,
  formSkillSelection,
  formSkillExecution,
  skillSourceEnabled,
  toggleSkillSource,
  skillVisibility,
  setSkillVisibility,
  togglePinnedSkill,
  skillExecutionOverrideFor,
  setSkillDefaultMode,
  setSkillForkToolPolicy,
  toggleSkillAllowedMode,
}: {
  descriptor: ProfileConfigDescriptor;
  skillCatalog: WorkspaceSkillInfo[];
  formSkillSelection: SkillSelection;
  formSkillExecution: SkillExecutionSelection;
  skillSourceEnabled: (source: SkillSource) => boolean;
  toggleSkillSource: (source: SkillSource) => void;
  skillVisibility: (skill: WorkspaceSkillInfo) => 'default' | 'include' | 'exclude';
  setSkillVisibility: (
    skill: WorkspaceSkillInfo,
    visibility: 'default' | 'include' | 'exclude'
  ) => void;
  togglePinnedSkill: (skill: WorkspaceSkillInfo) => void;
  skillExecutionOverrideFor: (skill: WorkspaceSkillInfo) => SkillExecutionOverride | undefined;
  setSkillDefaultMode: (skill: WorkspaceSkillInfo, mode: SkillDefaultModeOption) => void;
  setSkillForkToolPolicy: (skill: WorkspaceSkillInfo, policy: SkillForkToolPolicyOption) => void;
  toggleSkillAllowedMode: (skill: WorkspaceSkillInfo, mode: SkillExecutionMode) => void;
}) {
  if (descriptor.capabilities.skills !== 'profile') {
    return (
      <CapabilityNote
        title="Managed by ~/.claude"
        body="Skills for the Claude runtime come from your ~/.claude configuration and aren't set per profile here."
      />
    );
  }

  const skillProviderCount = formSkillSelection.providers?.length ?? 0;
  const skillIncludeCount = formSkillSelection.include?.length ?? 0;
  const pinnedSkillCount = formSkillSelection.pinned?.length ?? 0;
  const skillPolicyOverrideCount = formSkillExecution.overrides?.length ?? 0;

  return (
    <div className="rounded-lg text-sm max-md:border-0 max-md:bg-transparent max-md:p-0 md:border md:border-border md:bg-secondary/50 md:p-3">
      <div className="mb-3 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
        <span>{skillProviderCount} sources</span>
        <span>{skillIncludeCount} included</span>
        <span>{pinnedSkillCount} pinned inline</span>
        <span>{skillPolicyOverrideCount} policy overrides</span>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        {(['workspace', 'external', 'plugin'] as SkillSource[]).map(source => (
          <label
            key={source}
            className="flex cursor-pointer items-center gap-2 rounded-md bg-background/60 px-2 py-1.5 text-xs capitalize max-md:py-2.5"
          >
            <input
              type="checkbox"
              checked={skillSourceEnabled(source)}
              onChange={() => toggleSkillSource(source)}
              aria-label={`enable ${source} skills`}
            />
            {source}
          </label>
        ))}
      </div>
      <div className="mt-3 space-y-2 border-t border-border/70 pt-2">
        {skillCatalog.length === 0 ? (
          <p className="text-xs text-muted-foreground">No skills discovered.</p>
        ) : (
          skillCatalog.map(skill => {
            const ref = skillRefFor(skill);
            const key = skillRefKey(ref);
            const pinned = (formSkillSelection.pinned ?? []).some(
              item => skillRefKey(item) === key
            );
            const executionOverride = skillExecutionOverrideFor(skill);
            return (
              <div key={key} className="rounded-md bg-background/60 px-2 py-2">
                {/* Name takes the line to itself below md — sharing
                    it with the select and Pin left it 177px of the
                    210px it needs. The two controls pair up beneath. */}
                <div className="flex min-w-0 flex-col gap-2 md:flex-row md:items-center md:gap-2">
                  <span
                    className="min-w-0 flex-1 truncate font-medium text-xs"
                    title={`${ref.source}/${skill.id}`}
                  >
                    {skill.name || skill.id}
                  </span>
                  <div className="flex items-center gap-2 md:contents">
                    <select
                      aria-label={`skill visibility ${key}`}
                      value={skillVisibility(skill)}
                      onChange={event =>
                        setSkillVisibility(skill, event.target.value as 'default' | 'include' | 'exclude')
                      }
                      className="rounded-md border border-border bg-secondary px-1 py-0.5 text-[10px] max-md:flex-1 max-md:py-1.5 max-md:text-xs"
                    >
                      <option value="default">Default</option>
                      <option value="include">Include</option>
                      <option value="exclude">Exclude</option>
                    </select>
                    <label className="flex cursor-pointer items-center gap-1 text-[10px] text-muted-foreground max-md:gap-2 max-md:px-2 max-md:py-1.5 max-md:text-xs">
                      <input
                        type="checkbox"
                        checked={pinned}
                        disabled={skillVisibility(skill) === 'exclude'}
                        onChange={() => togglePinnedSkill(skill)}
                        aria-label={`pin skill ${key}`}
                      />
                      Pin
                    </label>
                  </div>
                </div>
                <p
                  // Two lines below md: this is the only place the
                  // description shows, and a title tooltip is no
                  // help on a touch screen.
                  className="mt-1 truncate font-mono text-[10px] text-muted-foreground max-md:line-clamp-2 max-md:whitespace-normal"
                  title={skill.description || `${ref.source}/${skill.id}`}
                >
                  {ref.source}/{skill.id} · {skill.description || 'No description'}
                </p>
                <div className="mt-2 grid gap-2 border-t border-border/60 pt-2 md:grid-cols-2">
                  <label className="min-w-0 text-[10px] text-muted-foreground">
                    <span className="mb-1 block">Default mode</span>
                    <select
                      aria-label={`skill default mode ${key}`}
                      value={executionOverride?.defaultMode ?? 'default'}
                      onChange={event =>
                        setSkillDefaultMode(skill, event.target.value as SkillDefaultModeOption)
                      }
                      className="w-full rounded-md border border-border bg-secondary px-1 py-0.5 text-[10px] max-md:py-1.5 max-md:text-xs"
                    >
                      <option value="default">Default</option>
                      <option value="inline">Inline</option>
                      <option value="fork">Fork</option>
                    </select>
                  </label>
                  <label className="min-w-0 text-[10px] text-muted-foreground">
                    <span className="mb-1 block">Fork tools</span>
                    <select
                      aria-label={`skill fork tool policy ${key}`}
                      value={executionOverride?.forkToolPolicy ?? 'default'}
                      onChange={event =>
                        setSkillForkToolPolicy(
                          skill,
                          event.target.value as SkillForkToolPolicyOption
                        )
                      }
                      className="w-full rounded-md border border-border bg-secondary px-1 py-0.5 text-[10px] max-md:py-1.5 max-md:text-xs"
                    >
                      <option value="default">Default</option>
                      <option value="read-only">Read-only</option>
                      <option value="web">Web</option>
                      <option value="workspace-edit">Workspace edit</option>
                      <option value="agent-default">Agent default</option>
                    </select>
                  </label>
                  <label className="flex cursor-pointer items-center gap-1 text-[10px] text-muted-foreground max-md:gap-2 max-md:py-1.5 max-md:text-xs">
                    <input
                      type="checkbox"
                      checked={executionOverride?.allowedModes?.includes('inline') ?? false}
                      onChange={() => toggleSkillAllowedMode(skill, 'inline')}
                      aria-label={`allow inline skill ${key}`}
                    />
                    Allow inline
                  </label>
                  <label className="flex cursor-pointer items-center gap-1 text-[10px] text-muted-foreground max-md:gap-2 max-md:py-1.5 max-md:text-xs">
                    <input
                      type="checkbox"
                      checked={executionOverride?.allowedModes?.includes('fork') ?? false}
                      onChange={() => toggleSkillAllowedMode(skill, 'fork')}
                      aria-label={`allow fork skill ${key}`}
                    />
                    Allow fork
                  </label>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
