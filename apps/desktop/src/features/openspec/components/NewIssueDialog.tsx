// apps/desktop/src/features/openspec/components/NewIssueDialog.tsx
//
// Modal for creating a new LocalIssue. Two flavors driven by `parentEpicId`:
//   - No parent → user creates either a new Epic (organizational container)
//     or a standalone sub-issue.
//   - Parent set → only sub-issue types; resulting issue is linked to the
//     parent Epic via `epicId`.
//
// On submit, the dialog routes to `createEpic` or `createSubIssue`, upserts
// the returned record into the store, then closes.

import React, { useId, useState } from 'react';
import type { LocalIssueType } from '@zclaudia/shared/features/local-issue';
import { useOpenSpecStore } from '../store.js';
import * as api from '../api.js';
import { Modal } from '../../../components/ui/Modal';

interface Props {
  projectId: string;
  /** If set, the new issue is linked to this Epic; type is constrained
   *  to sub-issue kinds. If unset, the user can also choose to create
   *  a new Epic container instead. */
  parentEpicId?: string;
  onClose: () => void;
}

type DialogMode = 'epic' | LocalIssueType;

const SUB_TYPES: { value: LocalIssueType; label: string }[] = [
  { value: 'implement', label: 'Implement' },
  { value: 'bug', label: 'Bug' },
  { value: 'enhancement', label: 'Enhancement' },
  { value: 'chore', label: 'Chore' },
];

export function NewIssueDialog({ projectId, parentEpicId, onClose }: Props): React.ReactElement {
  const upsertIssue = useOpenSpecStore(s => s.upsertIssue);
  const setSpecChange = useOpenSpecStore(s => s.setSpecChange);
  const fieldId = useId();
  const typeId = `${fieldId}-type`;
  const titleId = `${fieldId}-title`;
  const [mode, setMode] = useState<DialogMode>(parentEpicId ? 'implement' : 'epic');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (): Promise<void> => {
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'epic') {
        // No store slice for epics yet — created Epic is reachable via
        // listEpics() on next refresh. The dialog just closes successfully.
        await api.createEpic({ projectId, title: title.trim() });
      } else {
        const { issue, specChange } = await api.createSubIssue({
          projectId,
          type: mode,
          title: title.trim(),
          epicId: parentEpicId,
        });
        upsertIssue(issue);
        setSpecChange(specChange);
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      ariaLabel="New Issue"
      title="New Issue"
      placement="center"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            className="px-3 py-1.5 text-sm rounded-md bg-secondary hover:bg-secondary/80"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="px-3 py-1.5 text-sm rounded-md bg-muted/60 text-foreground hover:bg-muted disabled:opacity-50"
            disabled={busy || !title.trim()}
            onClick={() => void onSubmit()}
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      }
    >
      <div className="px-4 py-3 space-y-3">
        <div>
          <label htmlFor={typeId} className="block text-xs text-muted-foreground mb-1">
            Type
          </label>
          {parentEpicId ? (
            <select
              id={typeId}
              className="w-full bg-background border border-border rounded-md px-2 py-1 text-sm"
              value={mode as string}
              onChange={e => setMode(e.target.value as DialogMode)}
            >
              {SUB_TYPES.map(s => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          ) : (
            <select
              id={typeId}
              className="w-full bg-background border border-border rounded-md px-2 py-1 text-sm"
              value={mode as string}
              onChange={e => setMode(e.target.value as DialogMode)}
            >
              <option value="epic">Epic (organizational container)</option>
              {SUB_TYPES.map(s => (
                <option key={s.value} value={s.value}>
                  {s.label} (standalone)
                </option>
              ))}
            </select>
          )}
        </div>
        <div>
          <label htmlFor={titleId} className="block text-xs text-muted-foreground mb-1">
            Title
          </label>
          <input
            id={titleId}
            type="text"
            className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={mode === 'epic' ? 'Epic title' : 'Issue title'}
            autoFocus
          />
        </div>
        {error && <div className="text-xs text-destructive">Error: {error}</div>}
      </div>
    </Modal>
  );
}
