import { useState, useEffect } from 'react';
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
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
              />
            </svg>
          }
          title="Theme"
          control={<ThemeToggle />}
        />
        <SettingsRow
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h8m-8 6h16"
              />
            </svg>
          }
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
      icon={
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
      }
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
      icon={
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
          />
        </svg>
      }
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
