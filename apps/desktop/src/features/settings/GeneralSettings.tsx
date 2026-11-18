import { Moon, Type } from 'lucide-react';
import { useUIStore, type FontSizePreset } from '../../stores/uiStore';
import { ThemeToggle } from './ThemeToggle';
import { AutoTitleSettings } from './AutoTitleSettings';
import { SettingsGroup, SettingsRow } from './ui/SettingsGroup';

export function GeneralSettings() {
  return (
    <div className="space-y-6">
      <SettingsGroup label="Appearance">
        <SettingsRow
          icon={<Moon className="w-4 h-4" strokeWidth={1.75} />}
          title="Theme"
          control={<ThemeToggle />}
        />
        <SettingsRow
          icon={<Type className="w-4 h-4" strokeWidth={1.75} />}
          title="Font size"
          description="Adjusts prose, code, and the input. Navigation and settings stay the same."
          control={<FontSizeToggle />}
        />
      </SettingsGroup>
      <AutoTitleSettings />
    </div>
  );
}

// --- Small inline components ---

const FONT_SIZE_OPTIONS: { key: FontSizePreset; label: string }[] = [
  { key: 'small', label: 'Small' },
  { key: 'medium', label: 'Medium' },
  { key: 'large', label: 'Large' },
];

function FontSizeToggle() {
  const { fontSize, setFontSize } = useUIStore();
  return (
    <div
      role="group"
      aria-label="Font size"
      className="flex items-center bg-secondary/80 rounded-lg p-0.5 gap-0.5"
    >
      {FONT_SIZE_OPTIONS.map(opt => (
        <button
          key={opt.key}
          onClick={() => setFontSize(opt.key)}
          aria-pressed={fontSize === opt.key}
          className={`h-8 px-3 rounded-md text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:h-11 ${
            fontSize === opt.key
              ? 'bg-card text-foreground shadow-apple-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
