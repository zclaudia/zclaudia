import { forwardRef, useMemo } from 'react';
import { Pin, PinOff, Sparkles, Terminal, Bookmark } from 'lucide-react';
import type { SkillRef } from '@zclaudia/shared';

/**
 * Cursor-style slash/skill command menu.
 *
 * The `suggestions` array is a single flat list (pinned skills first, then
 * other skills, then commands) so the caller's keyboard navigation index stays
 * simple and contiguous. This component only handles the *visual* grouping —
 * it renders section headers between groups but keeps each row's
 * `data-index` equal to its position in the flat list, which the parent uses
 * for scroll-into-view.
 */

export interface SlashSuggestion {
  index: number;
  type: 'command' | 'skill';
  value: string;
  description: string;
  // skill-only fields
  argumentHint?: string;
  usageCount?: number;
  source?: string;
  mode?: string;
  pinned?: boolean;
  skillRef?: SkillRef;
}

export interface SlashMenuProps {
  suggestions: SlashSuggestion[];
  selectedIndex: number;
  pinEnabled: boolean; // false while the agent profile is still loading
  onSelect: (suggestion: SlashSuggestion) => void;
  onTogglePin: (ref: SkillRef, nextPinned: boolean) => void;
}

interface Group {
  key: string;
  label: string;
  icon: typeof Sparkles;
  items: SlashSuggestion[];
}

/**
 * Partition the flat suggestion list into visual groups. Assumes the caller
 * has already ordered the list: pinned skills → skills → commands.
 */
function groupSuggestions(suggestions: SlashSuggestion[]): Group[] {
  const pinned: SlashSuggestion[] = [];
  const skills: SlashSuggestion[] = [];
  const commands: SlashSuggestion[] = [];
  for (const s of suggestions) {
    if (s.type === 'command') commands.push(s);
    else if (s.pinned) pinned.push(s);
    else skills.push(s);
  }

  const groups: Group[] = [];
  if (pinned.length) {
    groups.push({ key: 'pinned', label: 'Pinned', icon: Bookmark, items: pinned });
  }
  if (skills.length) {
    groups.push({ key: 'skills', label: 'Skills', icon: Sparkles, items: skills });
  }
  if (commands.length) {
    groups.push({ key: 'commands', label: 'Commands', icon: Terminal, items: commands });
  }
  return groups;
}

function SkillBadges({ suggestion }: { suggestion: SlashSuggestion }) {
  return (
    <>
      {suggestion.argumentHint && (
        <span className="text-xs text-muted-foreground font-mono">{suggestion.argumentHint}</span>
      )}
      {suggestion.usageCount ? (
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground/80">
          ×{suggestion.usageCount}
        </span>
      ) : null}
      {suggestion.source && (
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">
          {suggestion.source}
        </span>
      )}
      {suggestion.mode && (
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">
          {suggestion.mode}
        </span>
      )}
    </>
  );
}

function PinButton({
  pinned,
  enabled,
  onClick,
}: {
  pinned: boolean;
  enabled: boolean;
  onClick: () => void;
}) {
  const Icon = pinned ? Pin : PinOff;
  return (
    <button
      type="button"
      aria-label={pinned ? 'Unpin skill' : 'Pin skill'}
      disabled={!enabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onMouseDown={(e) => e.stopPropagation()} // prevent textarea blur
      className={`shrink-0 rounded p-1 transition-colors ${
        pinned
          ? 'text-primary opacity-100'
          : 'text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100'
      } ${enabled ? 'hover:bg-muted hover:text-foreground cursor-pointer' : 'cursor-not-allowed'}`}
    >
      <Icon size={13} strokeWidth={2} className={pinned ? 'fill-primary/20' : ''} />
    </button>
  );
}

export const SlashMenu = forwardRef<HTMLDivElement, SlashMenuProps>(function SlashMenu(
  { suggestions, selectedIndex, pinEnabled, onSelect, onTogglePin },
  ref,
) {
  const groups = useMemo(() => groupSuggestions(suggestions), [suggestions]);

  return (
    <div
      ref={ref}
      className="absolute bottom-full left-0 right-0 mb-1 bg-popover border border-border rounded-lg shadow-apple-md overflow-y-auto max-h-64 z-10"
    >
      {groups.map((group) => (
        <div key={group.key} className="py-1">
          <div className="flex items-center gap-1.5 px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <group.icon size={11} strokeWidth={2} />
            {group.label}
          </div>
          {group.items.map((suggestion) => {
            const selected = suggestion.index === selectedIndex;
            const isSkill = suggestion.type === 'skill';
            return (
              <button
                key={`${suggestion.type}:${suggestion.value}`}
                data-index={suggestion.index}
                onClick={() => onSelect(suggestion)}
                className={`group relative w-full pl-3 pr-2 py-1.5 text-left flex items-center gap-2.5 transition-colors ${
                  selected ? 'bg-accent' : 'hover:bg-muted/60'
                }`}
              >
                {/* left accent bar for the keyboard-selected row */}
                <span
                  className={`absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-full bg-primary transition-opacity ${
                    selected ? 'opacity-100' : 'opacity-0'
                  }`}
                />
                <span
                  className={`font-mono text-sm shrink-0 ${
                    isSkill ? 'text-primary' : 'text-foreground'
                  }`}
                >
                  {suggestion.value}
                </span>
                <span className="flex-1 min-w-0 text-muted-foreground text-sm truncate">
                  {suggestion.description}
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  {isSkill ? <SkillBadges suggestion={suggestion} /> : null}
                  {(() => {
                    const ref = suggestion.skillRef;
                    if (!isSkill || !ref) return null;
                    return (
                      <PinButton
                        pinned={!!suggestion.pinned}
                        enabled={pinEnabled}
                        onClick={() => onTogglePin(ref, !suggestion.pinned)}
                      />
                    );
                  })()}
                </div>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
});
