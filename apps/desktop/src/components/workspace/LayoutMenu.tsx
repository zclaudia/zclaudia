import { useEffect, useRef, useState } from 'react';
import { Check, LayoutTemplate } from 'lucide-react';
import { useLayoutPresetStore } from '../../stores/layoutPresetStore';
import { useRightWorkspaceStore } from '../../stores/rightWorkspaceStore';
import { promptText } from '../../stores/confirmDialogStore';
import { applyLayoutPreset, saveCurrentLayoutPreset } from '../../actions/layoutPresetActions';
import { DropdownMenu, type DropdownMenuEntry } from '../ui/DropdownMenu';
import { IconButton } from '../ui/Button';
import { useWorkspacePane } from './WorkspaceContext';

export function LayoutMenu({ projectId }: { projectId: string }) {
  const presets = useLayoutPresetStore(s => s.presets);
  const selectedId = useLayoutPresetStore(s => s.selectedByProject[projectId]);
  const selected = presets.find(p => p.id === selectedId);
  const pane = useWorkspacePane();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [error, setError] = useState('');
  const report = (result: { ok: boolean; error?: string }) =>
    setError(
      result.ok
        ? ''
        : result.error === 'duplicate-name'
          ? 'A layout with this name already exists.'
          : result.error === 'empty-name'
            ? 'Enter a layout name.'
            : 'Unable to update this layout.'
    );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        !(e.metaKey || e.ctrlKey) ||
        !e.altKey ||
        e.key.toLowerCase() !== 'l' ||
        !pane
      )
        return;
      if (
        useRightWorkspaceStore.getState().bySession[pane.workspaceId]?.focusedPaneId !==
          pane.paneId ||
        triggerRef.current?.closest('[hidden]')
      )
        return;
      e.preventDefault();
      triggerRef.current?.click();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pane]);
  const entries: DropdownMenuEntry[] = presets.map(preset => ({
    key: preset.id,
    label: preset.name,
    icon: selectedId === preset.id ? <Check size={14} /> : undefined,
    onSelect: () => report(applyLayoutPreset(projectId, preset.id)),
  }));
  entries.push('separator', {
    key: 'save',
    label: 'Save current layout…',
    onSelect: () => {
      void promptText({
        title: 'Save layout',
        placeholder: 'Layout name',
        confirmLabel: 'Save',
      }).then(name => {
        if (name !== null) report(saveCurrentLayoutPreset(projectId, name));
      });
    },
  });
  if (selected && !selected.builtin)
    entries.push(
      {
        key: 'rename',
        label: 'Rename layout…',
        onSelect: () => {
          void promptText({
            title: 'Rename layout',
            defaultValue: selected.name,
            confirmLabel: 'Rename',
          }).then(name => {
            if (name !== null)
              report(useLayoutPresetStore.getState().renamePreset(selected.id, name));
          });
        },
      },
      {
        key: 'delete',
        label: 'Delete saved layout',
        destructive: true,
        onSelect: () => report(useLayoutPresetStore.getState().deletePreset(selected.id)),
      }
    );
  return (
    <>
      <DropdownMenu
        ariaLabel="Layout"
        align="end"
        entries={entries}
        trigger={({ ref, props }) => (
          <IconButton
            ref={el => {
              ref(el);
              triggerRef.current = el;
            }}
            {...props}
            size="sm"
            aria-label="Layout"
            aria-keyshortcuts="Control+Alt+L Meta+Alt+L"
          >
            <LayoutTemplate size={14} strokeWidth={1.75} />
          </IconButton>
        )}
      />
      {error && (
        <button
          type="button"
          role="alert"
          className="max-w-40 truncate text-3xs text-destructive"
          onClick={() => setError('')}
        >
          {error}
        </button>
      )}
    </>
  );
}
