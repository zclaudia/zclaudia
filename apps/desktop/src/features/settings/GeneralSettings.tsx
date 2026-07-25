import { useState, useEffect } from 'react';
import { Bell, Monitor, Moon, Type } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useUIStore, type FontSizePreset } from '../../stores/uiStore';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { ThemeToggle } from './ThemeToggle';
import { Select } from '../../components/ui/Select';
import { SettingsGroup, SettingsRow } from './ui/SettingsGroup';
import { Toggle } from '../../components/ui/Toggle';

export function GeneralSettings() {
  const isMobile = useIsMobile();

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
        {!isMobile && <NotchPanelToggle />}
        {!isMobile && <NotchMonitorSelector />}
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
          className={`px-3 py-1 rounded-md text-xs font-medium transition-all duration-200 ${
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

function NotchPanelToggle() {
  const { showNotchPanel, setShowNotchPanel } = useUIStore();
  return (
    <SettingsRow
      icon={<Bell className="w-4 h-4" strokeWidth={1.75} />}
      title="Notification Panel"
      description="Show Dynamic Island-style notifications at top of screen"
      control={
        <Toggle
          checked={showNotchPanel}
          onChange={setShowNotchPanel}
          aria-label="Notification panel"
        />
      }
    />
  );
}

interface MonitorInfo {
  name: string | null;
  width: number;
  height: number;
  scale_factor: number;
}

function NotchMonitorSelector() {
  const { showNotchPanel, notchMonitor, setNotchMonitor } = useUIStore();
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);

  useEffect(() => {
    if (!showNotchPanel) return;
    invoke<MonitorInfo[]>('list_monitors')
      .then(setMonitors)
      .catch(() => setMonitors([]));
  }, [showNotchPanel]);

  if (!showNotchPanel || monitors.length <= 1) return null;

  return (
    <SettingsRow
      icon={<Monitor className="w-4 h-4" strokeWidth={1.75} />}
      title="Notification Display"
      control={
        <Select
          value={notchMonitor === null ? '' : String(notchMonitor)}
          onChange={next => setNotchMonitor(next === '' ? null : parseInt(next, 10))}
          size="md"
          align="right"
          triggerClassName="min-w-[160px]"
          options={[
            { value: '', label: 'Primary' },
            ...monitors.map((m, i) => ({
              value: String(i),
              label: `${m.name || `Monitor ${i + 1}`} (${m.width}x${m.height})`,
            })),
          ]}
        />
      }
    />
  );
}
