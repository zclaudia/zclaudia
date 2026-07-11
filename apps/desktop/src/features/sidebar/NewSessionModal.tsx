import { useEffect, useRef } from 'react';
import type { Project } from '@zclaudia/shared';
import { Modal } from '../../components/ui/Modal';
import { Select } from '../../components/ui/Select';
import type { SidebarAgent } from './types';

interface NewSessionModalProps {
  open: boolean;
  onClose: () => void;
  /** null = no project chosen yet (picker flow). */
  project: Project | null;
  agents: SidebarAgent[];
  name: string;
  onNameChange: (name: string) => void;
  agentProfileId: string;
  onAgentProfileIdChange: (id: string) => void;
  onCreate: () => void;
  isConnected: boolean;
  isMobile?: boolean;
  /** Options for the project picker (picker flow only). */
  projects?: Project[];
  /** Render the project picker row; set once at open time. */
  showProjectPicker?: boolean;
  onProjectChange?: (projectId: string) => void;
}

export function NewSessionModal({
  open,
  onClose,
  project,
  agents,
  name,
  onNameChange,
  agentProfileId,
  onAgentProfileIdChange,
  onCreate,
  isConnected,
  isMobile = false,
  projects = [],
  showProjectPicker = false,
  onProjectChange,
}: NewSessionModalProps) {
  const nameRef = useRef<HTMLInputElement>(null);

  const projectRoot = project?.rootPath ?? '';
  const selectedModel = agents.find(a => a.id === agentProfileId)?.model ?? null;

  useEffect(() => {
    if (open) nameRef.current?.focus();
  }, [open]);

  const footer = (
    <div className="flex justify-end gap-2">
      <button
        onClick={onClose}
        className="h-7 rounded-xl px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        Cancel
      </button>
      <button
        onClick={onCreate}
        disabled={!isConnected || !project}
        className="h-7 rounded-xl bg-primary px-3 text-[13px] font-medium text-primary-foreground shadow-apple-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Create
      </button>
    </div>
  );

  return (
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
        {showProjectPicker && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">Project</span>
            <Select
              value={project?.id ?? ''}
              onChange={id => {
                if (id) onProjectChange?.(id);
              }}
              block
              size="md"
              triggerClassName="!h-9 !rounded-xl !text-[13px]"
              options={[
                { value: '', label: 'Choose a project…' },
                ...projects.map(p => ({ value: p.id, label: p.name })),
              ]}
            />
          </div>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">Name</span>
          <input
            ref={nameRef}
            type="text"
            value={name}
            onChange={e => onNameChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && project) onCreate();
            }}
            placeholder="Session name (optional)"
            className="h-9 w-full rounded-xl border border-border bg-background px-3 text-[13px] text-foreground placeholder:text-muted-foreground/50 transition-colors focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">Agent</span>
          <Select
            value={agentProfileId}
            onChange={onAgentProfileIdChange}
            block
            size="md"
            triggerClassName="!h-9 !rounded-xl !text-[13px]"
            options={[
              { value: '', label: 'Default (from project)' },
              ...agents.map(a => ({
                value: a.id,
                label: `${a.name}${a.isDefault ? ' *' : ''}`,
              })),
            ]}
          />
          {selectedModel && (
            <span className="px-0.5 text-[11px] text-muted-foreground/60">{selectedModel}</span>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">Working directory</span>
          <span
            className="truncate rounded-xl border border-border bg-muted/40 px-3 py-2 font-mono text-[12px] text-muted-foreground"
            title={projectRoot}
          >
            {projectRoot || '—'}
          </span>
          <span className="px-0.5 text-[11px] text-muted-foreground/60">
            Sessions run in the project directory.
          </span>
        </div>
      </div>
    </Modal>
  );
}
