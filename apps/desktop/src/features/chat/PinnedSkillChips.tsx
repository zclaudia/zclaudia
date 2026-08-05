import { useMemo } from 'react';
import { Sparkles, X } from 'lucide-react';
import type { SkillRef } from '@zclaudia/shared';
import { skillRefKey } from '@zclaudia/shared';
import type { WorkspaceSkillInfo } from '../../services/api/workspace-skills';

/**
 * Resident pinned-skill chip strip rendered above the composer textarea.
 *
 * Each chip represents a skill pinned to the current agent profile. Clicking a
 * chip inserts `/<id> ` into the composer (the same action as selecting it from
 * the slash menu); the trailing `X` unpins it. The strip renders nothing when
 * there are no pinned skills (so it occupies no vertical space in that case).
 *
 * A pinned skill that isn't present in the current `skills` list (e.g. removed
 * from disk, or a stale pin on another machine) is still rendered as a chip
 * with a fallback label and a subtle "stale" style so the user can unpin it.
 */
export interface PinnedSkillChipsProps {
  pinnedRefs: SkillRef[];
  skills: WorkspaceSkillInfo[];
  /** Click on the chip body (not the X) → insert `/<id> ` into the composer. */
  onActivate: (skillId: string) => void;
  /** Click on the X → remove this skill from the profile's pinned list. */
  onUnpin: (ref: SkillRef) => void;
}

interface ResolvedChip {
  ref: SkillRef;
  skillId: string;
  label: string;
  description?: string;
  stale: boolean; // pinned but not found in the current skills list
}

export function PinnedSkillChips({
  pinnedRefs,
  skills,
  onActivate,
  onUnpin,
}: PinnedSkillChipsProps) {
  const byKey = useMemo(() => {
    const m = new Map<string, WorkspaceSkillInfo>();
    for (const s of skills) m.set(skillRefKey({ source: s.source ?? 'workspace', id: s.id }), s);
    return m;
  }, [skills]);

  const chips = useMemo<ResolvedChip[]>(() => {
    return pinnedRefs.map(ref => {
      const skill = byKey.get(skillRefKey(ref));
      if (skill) {
        return {
          ref,
          skillId: skill.id,
          label: skill.name || skill.id,
          description: skill.description,
          stale: false,
        };
      }
      return {
        ref,
        skillId: ref.id,
        label: ref.id,
        stale: true,
      };
    });
  }, [pinnedRefs, byKey]);

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
      {chips.map(chip => (
        <span
          key={skillRefKey(chip.ref)}
          className={`group inline-flex items-center gap-1 rounded-full border pl-2 pr-1 py-0.5 text-[11px] font-medium transition-colors ${
            chip.stale
              ? 'border-border bg-muted/50 text-muted-foreground'
              : 'border-primary/40 bg-primary/20 text-primary hover:bg-primary/30'
          }`}
        >
          <Sparkles size={11} strokeWidth={2} className="shrink-0 opacity-70" />
          <button
            type="button"
            onClick={() => onActivate(chip.skillId)}
            className="cursor-pointer truncate max-w-[160px]"
            title={chip.description || chip.label}
          >
            {chip.label}
          </button>
          <button
            type="button"
            aria-label={`Unpin ${chip.label}`}
            onClick={() => onUnpin(chip.ref)}
            onMouseDown={e => e.stopPropagation()}
            className="rounded-full p-0.5 text-current opacity-50 hover:opacity-100 hover:bg-foreground/10 transition-opacity cursor-pointer relative before:absolute before:-inset-1 before:content-[''] md:before:content-none"
          >
            <X size={11} strokeWidth={2.5} />
          </button>
        </span>
      ))}
    </div>
  );
}
