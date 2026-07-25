import { MoreHorizontal } from 'lucide-react';
import { IconButton } from '../../../components/ui/Button';
import { DropdownMenu } from '../../../components/ui/DropdownMenu';

export interface ActionsMenuAction {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

/** The "⋯" dropdown used on library cards and editor headers. Built on the
 *  DropdownMenu primitive, which supplies Escape/arrow-key handling, focus
 *  return, and viewport clamping. */
export function ActionsMenu({
  actions,
  ariaLabel = 'More actions',
}: {
  actions: ActionsMenuAction[];
  ariaLabel?: string;
}) {
  return (
    <DropdownMenu
      align="end"
      ariaLabel={ariaLabel}
      entries={actions.map(action => ({
        key: action.label,
        label: action.label,
        onSelect: action.onSelect,
        disabled: action.disabled,
        destructive: action.destructive,
      }))}
      trigger={({ ref, props }) => (
        <IconButton ref={ref} {...props} aria-label={ariaLabel}>
          <MoreHorizontal size={16} strokeWidth={1.75} />
        </IconButton>
      )}
    />
  );
}
