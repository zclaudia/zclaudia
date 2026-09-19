import { useMemo } from 'react';
import type { SlashCommand, SkillRef } from '@zclaudia/shared';
import { skillRefKey } from '@zclaudia/shared';
import type { InvocableDescriptor } from '@zclaudia/shared/providers';
import type { WorkspaceSkillInfo } from '../../../services/api/workspace-skills';
import type { SlashSuggestion } from '../SlashMenu';

interface UseSlashSuggestionsOptions {
  /** Current composer text (only `/query` without a space shows the menu). */
  value: string;
  commands: SlashCommand[];
  workspaceSkills: WorkspaceSkillInfo[];
  /** Keys (`skillRefKey`) of skills pinned on the active agent profile. */
  pinnedKeys: Set<string>;
  /** URIP catalog matches for the text being typed (canonical invocables). */
  invocableSuggestions?: (typedText: string) => InvocableDescriptor[];
}

/**
 * Filters and orders the slash-menu suggestions for the current composer
 * text: URIP catalog invocables, then pinned skills, then remaining skills by
 * usage desc, then commands. Indices are reassigned contiguously so keyboard
 * navigation and scroll-into-view stay aligned across the visual groups
 * rendered by SlashMenu.
 */
export function useSlashSuggestions({
  value,
  commands,
  workspaceSkills,
  pinnedKeys,
  invocableSuggestions,
}: UseSlashSuggestionsOptions) {
  // Filter commands based on input (memoized to avoid O(n) filter on every render)
  const slashSuggestions = useMemo<SlashSuggestion[]>(() => {
    if (!value.startsWith('/') || value.includes(' ')) return [];
    const query = value.toLowerCase();
    const skillSuggestions: SlashSuggestion[] = workspaceSkills
      .filter(skill => skill.eligible !== false && skill.metadata?.userInvocable !== false)
      .filter(skill => `/${skill.id}`.toLowerCase().startsWith(query))
      .map((skill): SlashSuggestion => {
        const ref: SkillRef = { source: skill.source ?? 'workspace', id: skill.id };
        return {
          index: 0, // reassigned below after ordering
          type: 'skill',
          value: `/${skill.id}`,
          description: skill.metadata?.whenToUse || skill.description,
          argumentHint: skill.metadata?.argumentHint || skill.metadata?.arguments?.join(' '),
          usageCount: skill.usage?.count,
          source: skill.source ?? 'workspace',
          mode: skill.execution?.defaultMode,
          pinned: pinnedKeys.has(skillRefKey(ref)),
          skillRef: ref,
        };
      });
    const commandSuggestions: SlashSuggestion[] = commands
      .filter(cmd => cmd.command.toLowerCase().startsWith(query))
      .map(
        (cmd): SlashSuggestion => ({
          index: 0,
          type: 'command',
          value: cmd.command,
          description: cmd.description,
        })
      );
    // URIP catalog items (§16.2): canonical entries from the session's
    // invocable catalog, matched by display trigger or alias. Selecting one
    // records the canonical ID while the composer keeps the editable text.
    const invocableSuggestionsList: SlashSuggestion[] = (invocableSuggestions?.(value) ?? []).map(
      (descriptor): SlashSuggestion => ({
        index: 0,
        type: 'invocable',
        value: descriptor.displayTrigger,
        description: descriptor.description || descriptor.label,
        argumentHint: descriptor.argumentHint,
        invocable: descriptor,
      })
    );
    // Order: catalog invocables, then pinned skills, then remaining skills by
    // usage desc, then commands. Reassign contiguous indices so keyboard-nav +
    // scroll-into-view stay aligned across the visual groups rendered by SlashMenu.
    return [...invocableSuggestionsList, ...skillSuggestions, ...commandSuggestions]
      .sort((a, b) => {
        const pa = a.type === 'skill' && a.pinned ? 1 : 0;
        const pb = b.type === 'skill' && b.pinned ? 1 : 0;
        if (pa !== pb) return pb - pa;
        if (a.type !== 'skill' || b.type !== 'skill') return 0;
        const ua = a.usageCount ?? 0;
        const ub = b.usageCount ?? 0;
        return ub - ua;
      })
      .map((s, index) => ({ ...s, index }));
  }, [value, commands, workspaceSkills, pinnedKeys, invocableSuggestions]);

  return slashSuggestions;
}
