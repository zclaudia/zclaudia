import { Moon, Type } from 'lucide-react';
import { useUIStore, type FontSizePreset } from '../../stores/uiStore';
import { ThemeToggle } from './ThemeToggle';
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
          control={<FontSizeToggle />}
        />
      </SettingsGroup>
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
    <div className="flex items-center bg-secondary/80 rounded-lg p-0.5 gap-0.5">
      {FONT_SIZE_OPTIONS.map(opt => (
        <button
          key={opt.key}
          onClick={() => setFontSize(opt.key)}
          className={`px-3 py-1 rounded-md text-xs font-medium transition-all duration-200 max-md:py-2 ${
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
