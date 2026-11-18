import {
  Archive,
  Download,
  ExternalLink,
  Info,
  MoreHorizontal,
  RotateCcw,
  Shield,
} from 'lucide-react';
import { IconButton } from '../../components/ui/Button';
import { DropdownMenu, type DropdownMenuEntry } from '../../components/ui/DropdownMenu';
import { Tooltip } from '../../components/ui/Tooltip';

interface SessionActionsMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isMobile: boolean;
  isLoading: boolean;
  archiveDisabled: boolean;
  canPopOut: boolean;
  onInfo: () => void;
  onSettings: () => void;
  onReset: () => void;
  onExport: () => void;
  onArchive: () => void;
  onPopOut: () => void;
}

export function SessionActionsMenu({
  open,
  onOpenChange,
  isMobile,
  isLoading,
  archiveDisabled,
  canPopOut,
  onInfo,
  onSettings,
  onReset,
  onExport,
  onArchive,
  onPopOut,
}: SessionActionsMenuProps) {
  const entries: DropdownMenuEntry[] = [
    ...(isMobile ? [{ key: 'info', label: 'Session info', icon: <Info />, onSelect: onInfo }] : []),
    { key: 'settings', label: 'Session settings', icon: <Shield />, onSelect: onSettings },
    {
      key: 'reset',
      label: 'Reset session',
      icon: <RotateCcw />,
      onSelect: onReset,
      disabled: isLoading,
    },
    { key: 'export', label: 'Export as Markdown', icon: <Download />, onSelect: onExport },
    ...(canPopOut
      ? [
          {
            key: 'pop-out',
            label: 'Open in new window',
            icon: <ExternalLink />,
            onSelect: onPopOut,
          },
        ]
      : []),
    'separator',
    {
      key: 'archive',
      label: 'Archive session',
      icon: <Archive />,
      onSelect: onArchive,
      disabled: archiveDisabled,
      destructive: true,
      description: archiveDisabled ? '请先停止运行，再归档此会话。' : undefined,
    },
  ];

  return (
    <DropdownMenu
      open={open}
      onOpenChange={onOpenChange}
      isMobile={isMobile}
      entries={entries}
      align="end"
      ariaLabel="Session actions"
      panelClassName="w-60 max-w-[calc(100vw-16px)]"
      trigger={({ ref, props, open: menuOpen }) => (
        <Tooltip
          content="Session actions"
          disabled={menuOpen}
          anchorClassName="inline-flex shrink-0"
        >
          <IconButton
            ref={ref}
            {...props}
            aria-label="Session actions"
            className={menuOpen ? 'bg-secondary text-foreground' : ''}
          >
            <MoreHorizontal size={16} strokeWidth={1.75} />
          </IconButton>
        </Tooltip>
      )}
    />
  );
}
