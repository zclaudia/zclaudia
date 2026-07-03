import { useEffect, useRef, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import type { Project } from '@zclaudia/shared';
import { Modal } from '../../components/ui/Modal';
import { Select } from '../../components/ui/Select';
import { DirectoryPickerModal } from './DirectoryPickerModal';
import type { SidebarAgent } from './types';

interface NewSessionModalProps {
  open: boolean;
  onClose: () => void;
  project: Project;
  /** Backend that owns the project (for the directory picker). */
  backendId: string | null;
  agents: SidebarAgent[];
  name: string;
  onNameChange: (name: string) => void;
  agentProfileId: string;
  onAgentProfileIdChange: (id: string) => void;
  /** null = use project root (omitted from the create request). */
  workingDirectory: string | null;
  onWorkingDirectoryChange: (dir: string | null) => void;
  onCreate: () => void;
  isConnected: boolean;
  isMobile?: boolean;
}

export function NewSessionModal({
  open,
  onClose,
  project,
  backendId,
  agents,
  name,
  onNameChange,
  agentProfileId,
  onAgentProfileIdChange,
  workingDirectory,
  onWorkingDirectoryChange,
  onCreate,
  isConnected,
  isMobile = false,
}: NewSessionModalProps) {
  const [showPicker, setShowPicker] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const projectRoot = project.rootPath ?? '';
  const displayDir = workingDirectory ?? projectRoot;
  const isCustomDir = workingDirectory != null && workingDirectory !== projectRoot;
  const selectedModel = agents.find(a => a.id === agentProfileId)?.model ?? null;

  useEffect(() => {
    if (open) nameRef.current?.focus();
  }, [open]);

  const footer = (
    <div className="flex gap-2">
      <button
        onClick={onCreate}
        disabled={!isConnected}
        className="flex-1 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-foreground shadow-apple-sm hover:bg-accent/80 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Create
      </button>
      <button
        onClick={onClose}
        className="flex-1 rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        Cancel
      </button>
    </div>
  );

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        ariaLabel="New session"
        title="New session"
        footer={footer}
        size="md"
        isMobile={isMobile}
      >
        <div className="flex flex-col gap-4 px-4 py-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">Name</span>
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={e => onNameChange(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') onCreate();
              }}
              placeholder="Session name (optional)"
              className="w-full rounded-lg border-0 bg-muted/60 px-3 py-2 text-sm text-foreground shadow-apple-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">Agent</span>
            <Select
              value={agentProfileId}
              onChange={onAgentProfileIdChange}
              block
              size="md"
              options={[
                { value: '', label: 'Default (from project)' },
                ...agents.map(a => ({
                  value: a.id,
                  label: `${a.name}${a.isDefault ? ' *' : ''}`,
                })),
              ]}
            />
            {selectedModel && (
              <span className="text-[11px] text-muted-foreground/60">{selectedModel}</span>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">Working directory</span>
            <div className="flex items-center gap-2">
              <span
                className="min-w-0 flex-1 truncate rounded-lg bg-muted/60 px-3 py-2 font-mono text-xs text-muted-foreground"
                title={displayDir}
              >
                {displayDir || '—'}
              </span>
              <button
                onClick={() => setShowPicker(true)}
                className="flex items-center gap-1.5 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <FolderOpen size={13} strokeWidth={1.75} />
                Change
              </button>
            </div>
            {isCustomDir && (
              <button
                onClick={() => onWorkingDirectoryChange(null)}
                className="self-start text-[11px] text-primary hover:underline"
              >
                Reset to project root
              </button>
            )}
          </div>
        </div>
      </Modal>

      <DirectoryPickerModal
        open={showPicker}
        backendId={backendId}
        initialPath={displayDir || undefined}
        onClose={() => setShowPicker(false)}
        onSelect={dir => onWorkingDirectoryChange(dir)}
      />
    </>
  );
}
