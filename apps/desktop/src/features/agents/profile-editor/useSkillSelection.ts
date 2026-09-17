import { useState } from 'react';
import type {
  SkillExecutionMode,
  SkillExecutionSelection,
  SkillForkToolPolicy,
  SkillSelection,
  SkillSource,
} from '@zclaudia/shared';
import { defaultSkillSelection, skillRefKey } from '@zclaudia/shared';
import type { WorkspaceSkillInfo } from '../../../services/api';
import { skillRefFor } from './derive';

export type SkillDefaultModeOption = 'default' | SkillExecutionMode;
export type SkillForkToolPolicyOption = 'default' | SkillForkToolPolicy;

/**
 * Skill source/visibility/pinning + per-skill execution-policy override state
 * for the profile editor's Capabilities tab.
 */
export function useSkillSelection() {
  const [formSkillSelection, setFormSkillSelection] =
    useState<SkillSelection>(defaultSkillSelection);
  const [formSkillExecution, setFormSkillExecution] = useState<SkillExecutionSelection>({
    overrides: [],
  });

  /** Replaces the skill selection and execution overrides wholesale (form populate). */
  const applySelection = (selection: SkillSelection, execution: SkillExecutionSelection) => {
    setFormSkillSelection(selection);
    setFormSkillExecution(execution);
  };

  const skillSourceEnabled = (source: SkillSource) =>
    (formSkillSelection.providers ?? []).some(provider => provider.source === source);

  const toggleSkillSource = (source: SkillSource) => {
    setFormSkillSelection(current => {
      const providers = current.providers ?? [];
      return {
        ...current,
        providers: providers.some(provider => provider.source === source)
          ? providers.filter(provider => provider.source !== source)
          : [...providers, { source } as NonNullable<SkillSelection['providers']>[number]],
      };
    });
  };

  const skillVisibility = (skill: WorkspaceSkillInfo): 'default' | 'include' | 'exclude' => {
    const key = skillRefKey(skillRefFor(skill));
    if ((formSkillSelection.exclude ?? []).some(ref => skillRefKey(ref) === key)) return 'exclude';
    if ((formSkillSelection.include ?? []).some(ref => skillRefKey(ref) === key)) return 'include';
    return 'default';
  };

  const setSkillVisibility = (
    skill: WorkspaceSkillInfo,
    visibility: 'default' | 'include' | 'exclude'
  ) => {
    const ref = skillRefFor(skill);
    const key = skillRefKey(ref);
    setFormSkillSelection(current => ({
      ...current,
      include:
        visibility === 'include'
          ? [...(current.include ?? []).filter(item => skillRefKey(item) !== key), ref]
          : (current.include ?? []).filter(item => skillRefKey(item) !== key),
      exclude:
        visibility === 'exclude'
          ? [...(current.exclude ?? []).filter(item => skillRefKey(item) !== key), ref]
          : (current.exclude ?? []).filter(item => skillRefKey(item) !== key),
      pinned:
        visibility === 'exclude'
          ? (current.pinned ?? []).filter(item => skillRefKey(item) !== key)
          : current.pinned,
    }));
  };

  const togglePinnedSkill = (skill: WorkspaceSkillInfo) => {
    const ref = skillRefFor(skill);
    const key = skillRefKey(ref);
    setFormSkillSelection(current => {
      const pinned = current.pinned ?? [];
      const selected = pinned.some(item => skillRefKey(item) === key);
      return {
        ...current,
        pinned: selected ? pinned.filter(item => skillRefKey(item) !== key) : [...pinned, ref],
      };
    });
  };

  const skillExecutionOverrideFor = (skill: WorkspaceSkillInfo) => {
    const key = skillRefKey(skillRefFor(skill));
    return (formSkillExecution.overrides ?? []).find(override => skillRefKey(override.ref) === key);
  };

  const updateSkillExecutionOverride = (
    skill: WorkspaceSkillInfo,
    patch: Partial<NonNullable<SkillExecutionSelection['overrides']>[number]>
  ) => {
    const ref = skillRefFor(skill);
    const key = skillRefKey(ref);
    setFormSkillExecution(current => {
      const existing = (current.overrides ?? []).find(
        override => skillRefKey(override.ref) === key
      );
      const next = {
        ...existing,
        ref,
        ...patch,
      };
      const normalized = {
        ref,
        ...(next.allowedModes && next.allowedModes.length > 0
          ? { allowedModes: next.allowedModes }
          : {}),
        ...(next.defaultMode ? { defaultMode: next.defaultMode } : {}),
        ...(next.forkToolPolicy ? { forkToolPolicy: next.forkToolPolicy } : {}),
      };
      const hasPolicy = Boolean(
        normalized.allowedModes || normalized.defaultMode || normalized.forkToolPolicy
      );
      const others = (current.overrides ?? []).filter(
        override => skillRefKey(override.ref) !== key
      );
      return { overrides: hasPolicy ? [...others, normalized] : others };
    });
  };

  const setSkillDefaultMode = (skill: WorkspaceSkillInfo, mode: SkillDefaultModeOption) => {
    updateSkillExecutionOverride(skill, { defaultMode: mode === 'default' ? undefined : mode });
  };

  const setSkillForkToolPolicy = (skill: WorkspaceSkillInfo, policy: SkillForkToolPolicyOption) => {
    updateSkillExecutionOverride(skill, {
      forkToolPolicy: policy === 'default' ? undefined : policy,
    });
  };

  const toggleSkillAllowedMode = (skill: WorkspaceSkillInfo, mode: SkillExecutionMode) => {
    const current = skillExecutionOverrideFor(skill)?.allowedModes ?? [];
    const selected = current.includes(mode);
    updateSkillExecutionOverride(skill, {
      allowedModes: selected ? current.filter(item => item !== mode) : [...current, mode],
    });
  };

  return {
    formSkillSelection,
    formSkillExecution,
    applySelection,
    skillSourceEnabled,
    toggleSkillSource,
    skillVisibility,
    setSkillVisibility,
    togglePinnedSkill,
    skillExecutionOverrideFor,
    setSkillDefaultMode,
    setSkillForkToolPolicy,
    toggleSkillAllowedMode,
  };
}
