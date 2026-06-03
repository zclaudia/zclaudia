import { ClipboardList, Lock } from 'lucide-react';

interface PlanModeToggleProps {
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  locked?: boolean;
  lockReason?: string;
}

/**
 * Plan mode chip-toggle. Click to flip the plan-mode boolean for the session.
 * When `locked` is true (Supervisor forced), the toggle shows a lock icon and
 * is disabled. Otherwise the icon is ClipboardList, matching the legacy
 * ModeSelector plan entry visual.
 */
export function PlanModeToggle({ value, onChange, disabled, locked, lockReason }: PlanModeToggleProps) {
  const isOn = value || locked;
  const Icon = locked ? Lock : ClipboardList;
  const title = locked
    ? (lockReason ?? 'Plan mode locked')
    : (isOn ? 'Plan mode ON — click to disable' : 'Click to enable Plan mode');

  return (
    <button
      type="button"
      onClick={() => { if (!disabled && !locked) onChange(!value); }}
      disabled={disabled || locked}
      title={title}
      aria-label={isOn ? 'Plan mode on' : 'Plan mode off'}
      className={[
        'inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium h-7 transition-colors',
        isOn
          ? 'bg-blue-600/15 text-blue-300 hover:bg-blue-600/25'
          : 'bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground',
        (disabled || locked) ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer',
      ].join(' ')}
    >
      <Icon size={14} strokeWidth={1.75} />
      <span>{isOn ? 'Plan ✓' : 'Plan'}</span>
    </button>
  );
}
