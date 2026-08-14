import { Check, ChevronDown, RotateCcw } from 'lucide-react';
import type { BrowserDeviceEmulation } from '@zclaudia/shared';
import { Button, IconButton } from '../../components/ui/Button';
import { DropdownMenu } from '../../components/ui/DropdownMenu';
import { DEVICE_PRESETS, toEmulation } from './devicePresets';

interface Props {
  emulation: BrowserDeviceEmulation;
  onChange(emulation: BrowserDeviceEmulation): void;
}

/** Slim bar under the toolbar while device emulation is active. */
export function DeviceBar({ emulation, onChange }: Props) {
  const preset = DEVICE_PRESETS.find((p) => p.id === emulation.presetId);
  const landscape = emulation.width > emulation.height;

  return (
    <div className="flex items-center gap-1 px-2 h-8 border-b border-border">
      <DropdownMenu
        ariaLabel="Device preset"
        entries={DEVICE_PRESETS.map((p) => ({
          key: p.id,
          label: p.label,
          icon: p.id === emulation.presetId ? <Check size={14} strokeWidth={1.75} /> : undefined,
          onSelect: () => onChange(toEmulation(p)),
        }))}
        trigger={({ ref, props }) => (
          <Button ref={ref} size="sm" className="gap-1" {...props}>
            {preset?.label ?? 'Custom'}
            <ChevronDown size={12} strokeWidth={1.75} aria-hidden />
          </Button>
        )}
      />
      <span className="text-[11px] font-mono text-muted-foreground/60">
        {emulation.width}×{emulation.height}
      </span>
      <div className="flex-1" />
      <IconButton
        size="sm"
        aria-label={landscape ? 'Rotate to portrait' : 'Rotate to landscape'}
        onClick={() => onChange({ ...emulation, width: emulation.height, height: emulation.width })}
      >
        <RotateCcw size={14} strokeWidth={1.75} />
      </IconButton>
    </div>
  );
}
