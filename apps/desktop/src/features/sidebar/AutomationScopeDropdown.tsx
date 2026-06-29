import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { AutomationScopeList } from './AutomationScopeList';

interface ScopeBackend { backendId: string; name: string; online: boolean }
interface ScopeProject { id: string; name: string }

interface AutomationScopeDropdownProps {
  label: string;
  backends: ScopeBackend[];
  getProjectsForBackend: (backendId: string) => ScopeProject[];
  expandedBackendIds: string[];
  onToggleBackend: (backendId: string) => void;
  activeBackendId: string | null;
  selectedProjectId?: string;
  onSelectBackend: (backendId: string) => void;
  onSelectProject: (backendId: string, projectId: string) => void;
}

export function AutomationScopeDropdown({ label, onSelectBackend, onSelectProject, ...scope }: AutomationScopeDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Select scope"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground hover:bg-secondary transition-colors"
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="w-4 h-4 flex-shrink-0 text-muted-foreground" strokeWidth={1.75} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-20 mt-1 max-h-80 overflow-y-auto rounded-md border border-border bg-popover p-2 shadow-md">
          <AutomationScopeList
            {...scope}
            onSelectBackend={(backendId) => { onSelectBackend(backendId); setOpen(false); }}
            onSelectProject={(backendId, projectId) => { onSelectProject(backendId, projectId); setOpen(false); }}
          />
        </div>
      )}
    </div>
  );
}
