import { useState } from 'react';
import { FolderOpen, Plus, X } from 'lucide-react';
import { Button, IconButton } from '../../components/ui/Button';
import { SECTION_LABEL } from '../../components/ui/typography';
import { DirectoryPickerModal } from './DirectoryPickerModal';

interface AdditionalDirectoriesFieldProps {
  value: string[];
  onChange: (next: string[]) => void;
  /** Backend whose filesystem the picker browses (null = default/local). */
  backendId: string | null;
  /** The primary working directory; extra directories need one to exist. */
  rootPath: string;
}

/**
 * Editor for a project's additional directories: paths the agent may read and
 * write beside the working directory. Shared by the New project dialog and
 * Project settings. Blank rows are kept while editing; callers drop them on
 * submit with {@link cleanAdditionalPaths}.
 */
export function AdditionalDirectoriesField({
  value,
  onChange,
  backendId,
  rootPath,
}: AdditionalDirectoriesFieldProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerIndex, setPickerIndex] = useState<number | null>(null);
  const hasRoot = rootPath.trim().length > 0;

  const openPicker = (index: number | null) => {
    setPickerIndex(index);
    setPickerOpen(true);
  };

  const handleSelect = (path: string) => {
    if (pickerIndex === null) {
      if (!value.includes(path)) onChange([...value, path]);
    } else {
      onChange(value.map((existing, i) => (i === pickerIndex ? path : existing)));
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className={SECTION_LABEL}>Additional directories</span>
      {value.map((path, index) => (
        <div
          key={index}
          className="flex h-9 items-center overflow-hidden rounded-md border border-border bg-background/70 transition-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring"
        >
          <input
            type="text"
            aria-label={`Additional directory ${index + 1}`}
            value={path}
            onChange={e => onChange(value.map((p, i) => (i === index ? e.target.value : p)))}
            placeholder="/absolute/path"
            className="min-w-0 flex-1 bg-transparent px-3 font-mono text-[12px] text-foreground placeholder:font-sans placeholder:text-muted-foreground/50 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => openPicker(index)}
            aria-label={`Browse for additional directory ${index + 1}`}
            title="Browse for folder"
            className="flex h-full flex-shrink-0 items-center border-l border-border px-2.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <FolderOpen size={15} strokeWidth={1.75} />
          </button>
          <IconButton
            aria-label={`Remove additional directory ${index + 1}`}
            title="Remove directory"
            onClick={() => onChange(value.filter((_, i) => i !== index))}
            className="mx-1"
          >
            <X size={14} strokeWidth={1.75} />
          </IconButton>
        </div>
      ))}
      <div>
        <Button size="sm" onClick={() => openPicker(null)} disabled={!hasRoot}>
          <Plus size={13} strokeWidth={1.75} />
          Add directory
        </Button>
      </div>
      <span className="px-0.5 text-[11px] text-muted-foreground/60">
        {hasRoot
          ? 'The agent can read and write these in addition to the working directory. Git status, worktrees and pull requests only cover the working directory.'
          : 'Set a working directory first to add more directories.'}
      </span>

      <DirectoryPickerModal
        open={pickerOpen}
        backendId={backendId}
        initialPath={
          (pickerIndex !== null ? value[pickerIndex]?.trim() : '') || rootPath.trim() || undefined
        }
        onClose={() => setPickerOpen(false)}
        onSelect={handleSelect}
      />
    </div>
  );
}

/** Trim and drop blank rows before sending to the server. */
export function cleanAdditionalPaths(paths: string[]): string[] {
  return paths.map(p => p.trim()).filter(Boolean);
}
