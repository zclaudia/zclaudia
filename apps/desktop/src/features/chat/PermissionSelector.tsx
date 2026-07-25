import { useState, useRef, useEffect } from 'react';
import {
  Shield,
  Scale,
  Rocket,
  LockOpen,
  Settings,
  Lightbulb,
  ChevronDown,
  SlidersHorizontal,
  AlertTriangle,
} from 'lucide-react';
import { SECTION_LABEL } from '../../components/ui/typography';
import type { LucideIcon } from 'lucide-react';
import type {
  UnifiedPermissionPolicy,
  CategoryAction,
  PermissionCategory,
  CategoryProfile,
} from '@zclaudia/shared';
import { SelectorTrigger } from './SelectorTrigger';

interface PermissionSelectorProps {
  value: Partial<UnifiedPermissionPolicy> | null;
  onChange: (policy: Partial<UnifiedPermissionPolicy> | null) => void;
  disabled?: boolean;
}

// Preset profiles mapping to v3 CategoryProfile
const PRESETS: {
  id: string;
  label: string;
  icon: LucideIcon;
  description: string;
  profile: CategoryProfile;
}[] = [
  {
    id: 'read-only',
    label: 'Read Only',
    icon: Shield,
    description: 'Only auto-approve read operations',
    profile: {
      fileRead: 'auto-approve',
      fileWrite: 'ask',
      shellSafe: 'ask',
      networkOps: 'ask',
      destructiveOps: 'block',
      userQuestions: 'ask',
    },
  },
  {
    id: 'standard',
    label: 'Standard',
    icon: Scale,
    description: '+ File edits auto-approved',
    profile: {
      fileRead: 'auto-approve',
      fileWrite: 'auto-approve',
      shellSafe: 'ask',
      networkOps: 'ask',
      destructiveOps: 'block',
      userQuestions: 'ask',
    },
  },
  {
    id: 'power-user',
    label: 'Power User',
    icon: Rocket,
    description: '+ Safe shell auto-approved',
    profile: {
      fileRead: 'auto-approve',
      fileWrite: 'auto-approve',
      shellSafe: 'auto-approve',
      networkOps: 'ask',
      destructiveOps: 'block',
      userQuestions: 'ask',
    },
  },
  {
    id: 'full-auto',
    label: 'Full Auto',
    icon: LockOpen,
    description: '+ Network ops auto-approved',
    profile: {
      fileRead: 'auto-approve',
      fileWrite: 'auto-approve',
      shellSafe: 'auto-approve',
      networkOps: 'auto-approve',
      destructiveOps: 'block',
      userQuestions: 'ask',
    },
  },
  {
    id: 'bypass-all',
    label: 'Bypass All',
    icon: AlertTriangle,
    description: '⚠ Auto-approves EVERYTHING including destructive operations',
    profile: {
      fileRead: 'auto-approve',
      fileWrite: 'auto-approve',
      shellSafe: 'auto-approve',
      networkOps: 'auto-approve',
      destructiveOps: 'auto-approve',
      userQuestions: 'auto-approve',
    },
  },
];

const CATEGORY_ORDER: PermissionCategory[] = [
  'fileRead',
  'fileWrite',
  'shellSafe',
  'networkOps',
  'destructiveOps',
  'userQuestions',
];

const CATEGORY_LABELS: Record<PermissionCategory, string> = {
  fileRead: 'File Read',
  fileWrite: 'File Write',
  shellSafe: 'Shell (safe)',
  networkOps: 'Network',
  destructiveOps: 'Destructive',
  userQuestions: 'User Qs',
};

const ACTION_OPTIONS: Array<{ value: CategoryAction; label: string }> = [
  { value: 'auto-approve', label: 'Auto' },
  { value: 'ask', label: 'Ask' },
  { value: 'block', label: 'Block' },
];

function profilesEqual(a: CategoryProfile, b: CategoryProfile): boolean {
  return CATEGORY_ORDER.every(cat => a[cat] === b[cat]);
}

export function PermissionSelector({ value, onChange, disabled }: PermissionSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setShowCustom(false);
      return;
    }
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  // Determine current label
  const getTriggerLabel = () => {
    if (!value) return 'Project Default';
    const profile = value.profile;
    if (profile) {
      const match = PRESETS.find(p => profilesEqual(p.profile, profile as CategoryProfile));
      if (match) return match.label;
      return 'Custom';
    }
    return 'Project Default';
  };

  const triggerLabel = getTriggerLabel();
  const hasOverride = value !== null;

  // Elevated = profile auto-approves file writes or shell commands
  const isElevated = !!(
    value?.profile &&
    (value.profile.fileWrite === 'auto-approve' || value.profile.shellSafe === 'auto-approve')
  );

  const handleSelectPreset = (preset: (typeof PRESETS)[number] | null) => {
    if (preset === null) {
      onChange(null);
    } else {
      onChange({ enabled: true, profile: { ...preset.profile } });
    }
    setIsOpen(false);
  };

  const handleCustomChange = (cat: PermissionCategory, action: CategoryAction) => {
    // Only store explicitly changed categories — unset ones inherit from project/global
    const newProfile = { ...value?.profile, [cat]: action } as CategoryProfile;
    onChange({ ...value, enabled: true, profile: newProfile });
  };

  const triggerStateClass = disabled
    ? ''
    : isElevated
      ? 'bg-warning/10 text-warning border border-warning/40 hover:bg-warning/15 hover:text-warning active:bg-warning/20'
      : hasOverride
        ? 'text-primary'
        : '';

  return (
    <div ref={ref} className="relative">
      <SelectorTrigger
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        title={triggerLabel}
        ariaHasPopup="menu"
        ariaExpanded={isOpen}
        className={triggerStateClass}
      >
        <Shield size={14} strokeWidth={1.75} />
        <span className="hidden md:inline truncate max-w-[80px] lg:max-w-none">{triggerLabel}</span>
        <ChevronDown size={12} className={isElevated ? '' : 'text-muted-foreground'} />
      </SelectorTrigger>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-1 z-50 bg-popover/95 glass border border-border/50 rounded-xl shadow-apple-xl py-1 min-w-[260px] max-h-[400px] overflow-y-auto animate-apple-fade-in">
          {/* Header */}
          <div className={`px-3 py-1.5 ${SECTION_LABEL} border-b border-border`}>
            Session permission override
          </div>

          {/* Project Default option */}
          <button
            onClick={() => handleSelectPreset(null)}
            className={`
              w-full text-left px-3 py-1.5 transition-colors
              ${
                !hasOverride
                  ? 'bg-muted/60 text-primary font-medium'
                  : 'text-foreground hover:bg-muted active:bg-muted'
              }
            `}
          >
            <div className="flex items-center gap-1.5 text-[13px]">
              <Settings size={13} strokeWidth={1.75} /> Project Default
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              Use project or global permission settings
            </div>
          </button>

          <div className="my-1 border-t border-border" />

          {/* Preset options */}
          {!showCustom && (
            <>
              {PRESETS.map(preset => {
                const isActive =
                  value?.profile && profilesEqual(preset.profile, value.profile as CategoryProfile);
                const isBypassAll = preset.id === 'bypass-all';
                return (
                  <button
                    key={preset.id}
                    onClick={() => handleSelectPreset(preset)}
                    className={`
                      w-full text-left px-3 py-1.5 transition-colors
                      ${
                        isActive
                          ? isBypassAll
                            ? 'bg-orange-500/15 text-orange-300 font-medium'
                            : 'bg-muted/60 text-primary font-medium'
                          : isBypassAll
                            ? 'text-orange-400 hover:bg-orange-500/10 active:bg-orange-500/15'
                            : 'text-foreground hover:bg-muted active:bg-muted'
                      }
                    `}
                  >
                    <div className="flex items-center gap-1.5 text-[13px]">
                      <preset.icon size={13} strokeWidth={1.75} /> {preset.label}
                    </div>
                    <div
                      className={`text-[10px] mt-0.5 ${isBypassAll ? 'text-orange-400/80' : 'text-muted-foreground'}`}
                    >
                      {preset.description}
                    </div>
                  </button>
                );
              })}

              <div className="my-1 border-t border-border" />

              {/* Custom option */}
              <button
                onClick={() => setShowCustom(true)}
                className={`
                  w-full text-left px-3 py-1.5 transition-colors
                  ${
                    triggerLabel === 'Custom'
                      ? 'bg-muted/60 text-primary font-medium'
                      : 'text-foreground hover:bg-muted active:bg-muted'
                  }
                `}
              >
                <div className="flex items-center gap-1.5 text-[13px]">
                  <SlidersHorizontal size={13} strokeWidth={1.75} /> Custom...
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  Fine-tune each category individually
                </div>
              </button>
            </>
          )}

          {/* Custom category editor */}
          {showCustom && (
            <div className="px-3 py-2 space-y-1">
              <button
                onClick={() => setShowCustom(false)}
                className="text-[10px] text-muted-foreground hover:text-foreground mb-1"
              >
                &larr; Back to presets
              </button>
              {CATEGORY_ORDER.map(cat => {
                const isLocked = cat === 'userQuestions';
                const currentValue = (
                  value?.profile as Record<string, CategoryAction> | undefined
                )?.[cat];
                return (
                  <div key={cat} className="flex items-center justify-between py-0.5">
                    <span className="text-[11px] font-medium">{CATEGORY_LABELS[cat]}</span>
                    <select
                      value={isLocked ? 'ask' : (currentValue ?? 'inherit')}
                      onChange={e => {
                        const val = e.target.value;
                        if (val === 'inherit') {
                          // Remove this category from override
                          const newProfile = { ...value?.profile } as Record<
                            string,
                            CategoryAction
                          >;
                          delete newProfile[cat];
                          onChange(
                            Object.keys(newProfile).length > 0
                              ? { ...value, enabled: true, profile: newProfile as CategoryProfile }
                              : null
                          );
                        } else {
                          handleCustomChange(cat, val as CategoryAction);
                        }
                      }}
                      disabled={isLocked}
                      className={`h-5 px-1.5 text-[10px] bg-background border border-border rounded-full focus:outline-none focus:ring-1 focus:ring-primary ${
                        isLocked ? 'opacity-50 cursor-not-allowed' : ''
                      } ${currentValue ? '' : 'text-muted-foreground'}`}
                    >
                      <option value="inherit">Inherit</option>
                      {ACTION_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          )}

          {/* Info footer */}
          <div className="px-3 py-1.5 text-[10px] text-muted-foreground border-t border-border mt-1">
            <span className="flex items-center gap-1">
              <Lightbulb size={10} strokeWidth={1.75} /> Session override is temporary
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
