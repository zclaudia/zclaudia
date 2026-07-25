import { useTheme, isDarkTheme, type Theme } from '../../contexts/ThemeContext';
import {
  Sun,
  SunSnow,
  Moon,
  Flame,
  Snowflake,
  Monitor,
  Check,
  ChevronDown,
  type LucideIcon,
} from 'lucide-react';
import { DropdownMenu, type DropdownMenuEntry } from '../../components/ui/DropdownMenu';

const THEME_OPTIONS: { value: Theme; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'light-cool', label: 'Light Cool', icon: SunSnow },
  { value: 'dark-neutral', label: 'Dark', icon: Moon },
  { value: 'dark-warm', label: 'Dark Warm', icon: Flame },
  { value: 'dark-cool', label: 'Dark Cool', icon: Snowflake },
  { value: 'system', label: 'System', icon: Monitor },
];

function getButtonIcon(theme: Theme, resolvedTheme: string): LucideIcon {
  if (theme === 'system') return Monitor;
  if (theme === 'light-cool') return SunSnow;
  if (isDarkTheme(resolvedTheme as any)) return Moon;
  return Sun;
}

export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();

  const currentOption = THEME_OPTIONS.find(opt => opt.value === theme) || THEME_OPTIONS[5];
  const ButtonIcon = getButtonIcon(theme, resolvedTheme);

  const entries: DropdownMenuEntry[] = THEME_OPTIONS.map(option => {
    const OptionIcon = option.icon;
    const active = theme === option.value;
    return {
      key: option.value,
      label: (
        <span className={`flex items-center gap-2 ${active ? 'text-primary' : ''}`}>
          <span className="flex-1">{option.label}</span>
          {active && <Check size={12} className="ml-auto" />}
        </span>
      ),
      icon: <OptionIcon size={14} strokeWidth={1.75} />,
      onSelect: () => setTheme(option.value),
    };
  });

  return (
    <DropdownMenu
      entries={entries}
      align="end"
      ariaLabel="Theme"
      panelClassName="w-44"
      trigger={({ ref, props, open }) => (
        <button
          ref={ref}
          {...props}
          aria-label="Change theme"
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md transition-colors ${
            open
              ? 'bg-card text-foreground shadow-apple-sm'
              : 'bg-secondary/50 text-muted-foreground hover:text-foreground hover:bg-secondary'
          }`}
        >
          <ButtonIcon size={14} strokeWidth={1.75} />
          <span className="hidden sm:inline">{currentOption.label}</span>
          <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      )}
    />
  );
}
