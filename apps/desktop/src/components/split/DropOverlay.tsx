import { useDragSplitStore, type DropZone } from './dragSplit';

const ZONES: { zone: DropZone; className: string }[] = [
  { zone: 'top', className: 'top-0 left-0 right-0 h-1/2' },
  { zone: 'bottom', className: 'bottom-0 left-0 right-0 h-1/2' },
  { zone: 'left', className: 'left-0 top-0 bottom-0 w-1/2' },
  { zone: 'right', className: 'right-0 top-0 bottom-0 w-1/2' },
];

/**
 * Four-quadrant drop overlay shown over a pane while a panel drag is active.
 * Renders nothing when no drag is in progress. The active zone (matching the
 * pointer) gets a strong highlight; disabled zones (would create a singleton
 * conflict) are dimmed. `center` is rendered as a small center indicator.
 *
 * The overlay itself does no hit-testing — the drag controller updates
 * `useDragSplitStore` (hoverPaneId/hoverZone/disabled) on pointermove, and this
 * component just reflects it.
 */
export function DropOverlay({ paneId }: { paneId: string }) {
  const active = useDragSplitStore((s) => s.active);
  const hoverPaneId = useDragSplitStore((s) => s.hoverPaneId);
  const hoverZone = useDragSplitStore((s) => s.hoverZone);
  const disabled = useDragSplitStore((s) => s.disabled);

  if (!active) return null;
  const isHovered = hoverPaneId === paneId;
  const showCenter = isHovered && hoverZone === 'center' && !disabled.has('center');

  return (
    <div className="absolute inset-0 pointer-events-none z-20">
      {ZONES.map(({ zone, className }) => {
        const isZone = isHovered && hoverZone === zone;
        const isDisabled = disabled.has(zone);
        return (
          <div
            key={zone}
            data-zone={zone}
            data-disabled={isDisabled ? 'true' : 'false'}
            data-active={isZone ? 'true' : 'false'}
            className={`absolute ${className} transition-colors ${
              isZone
                ? isDisabled
                  ? 'bg-destructive/30'
                  : 'bg-primary/30'
                : isHovered
                  ? 'bg-muted/20'
                  : ''
            }`}
          />
        );
      })}
      {/* Center indicator */}
      <div
        className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 rounded-md border-2 transition-colors ${
          showCenter ? 'border-primary bg-primary/30' : 'border-muted'
        }`}
        data-zone="center"
      />
    </div>
  );
}
