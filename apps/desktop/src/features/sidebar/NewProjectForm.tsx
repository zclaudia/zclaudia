import { useState } from 'react';
import { FolderOpen } from 'lucide-react';
import type { NewProjectFormProps } from './types';
import { DirectoryPickerModal } from './DirectoryPickerModal';

export function NewProjectForm({
  showForm,
  onShowForm,
  newProjectName,
  onProjectNameChange,
  newProjectRootPath,
  onProjectRootPathChange,
  onCreateProject,
  creatingProject,
  isMobile,
  backends,
  selectedBackendId,
  onSelectedBackendIdChange,
}: NewProjectFormProps) {
  const inputClass = isMobile
    ? 'w-full px-3 py-2.5 bg-muted/60 border-0 rounded-lg text-sm shadow-apple-sm focus:outline-none focus:ring-1 focus:ring-primary/50'
    : 'w-full px-2 py-1.5 bg-muted/60 border-0 rounded-lg text-sm shadow-apple-sm focus:outline-none focus:ring-1 focus:ring-primary/50';
  const rootFieldClass = isMobile
    ? 'flex-1 min-w-0 px-3 py-2.5 bg-muted/60 border-0 rounded-lg text-sm shadow-apple-sm focus:outline-none focus:ring-1 focus:ring-primary/50'
    : 'flex-1 min-w-0 px-2 py-1.5 bg-muted/60 border-0 rounded-lg text-sm shadow-apple-sm focus:outline-none focus:ring-1 focus:ring-primary/50';
  const browseBtnClass = isMobile
    ? 'flex-shrink-0 px-3 bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted/80 rounded-lg flex items-center justify-center shadow-apple-sm'
    : 'flex-shrink-0 px-2 bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground rounded-lg flex items-center justify-center shadow-apple-sm';
  const buttonRowClass = isMobile ? 'flex gap-2 mt-2' : 'flex gap-1 mt-1.5';
  const createBtnClass = isMobile
    ? 'flex-1 px-3 py-2.5 bg-accent text-foreground font-medium shadow-apple-sm hover:bg-accent/80 active:bg-accent/70 rounded-lg text-sm disabled:opacity-50'
    : 'flex-1 px-2 py-1 bg-accent text-foreground font-medium shadow-apple-sm hover:bg-accent/80 rounded-lg text-xs disabled:opacity-50';
  const cancelBtnClass = isMobile
    ? 'flex-1 px-3 py-2.5 bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted/80 rounded-lg text-sm'
    : 'flex-1 px-2 py-1 bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground rounded-lg text-xs';

  const [pickerOpen, setPickerOpen] = useState(false);

  const handleCancel = () => {
    onShowForm(false);
    onProjectNameChange('');
    onProjectRootPathChange('');
  };

  if (showForm) {
    return (
      <div className="mt-1 px-1">
        {backends.length > 1 && (
          <select
            aria-label="Create in backend"
            value={selectedBackendId ?? backends[0]?.backendId ?? ''}
            onChange={e => onSelectedBackendIdChange(e.target.value)}
            className="mb-2 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground focus:outline-none"
          >
            {backends.map(b => (
              <option key={b.backendId} value={b.backendId}>
                {b.name}
              </option>
            ))}
          </select>
        )}
        <input
          type="text"
          value={newProjectName}
          onChange={e => onProjectNameChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') handleCancel();
          }}
          placeholder="Project name"
          className={inputClass}
          autoFocus
        />
        <div className="mt-1 flex gap-1">
          <input
            type="text"
            value={newProjectRootPath}
            onChange={e => onProjectRootPathChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') onCreateProject();
              if (e.key === 'Escape') handleCancel();
            }}
            placeholder="Working directory (browse or type)"
            className={rootFieldClass}
          />
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            aria-label="Browse for folder"
            title="Browse for folder"
            className={browseBtnClass}
          >
            <FolderOpen size={16} strokeWidth={1.75} />
          </button>
        </div>
        <DirectoryPickerModal
          open={pickerOpen}
          backendId={selectedBackendId ?? backends[0]?.backendId ?? null}
          initialPath={newProjectRootPath.trim() || undefined}
          onClose={() => setPickerOpen(false)}
          onSelect={path => onProjectRootPathChange(path)}
        />
        <div className={buttonRowClass}>
          <button
            onClick={onCreateProject}
            disabled={!newProjectName.trim() || creatingProject}
            className={createBtnClass}
          >
            {creatingProject ? 'Creating...' : 'Create'}
          </button>
          <button onClick={handleCancel} className={cancelBtnClass}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return null;
}
