import { useState } from 'react';
import * as api from '../../services/api';
import type { SkillLoadDiagnostic } from '../../services/api';

/**
 * Parent must remount this component per backend — key it by `backendId`.
 * The local dirs draft is seeded from the `dirs` prop on mount only;
 * prop-driven switching of backendId without a key change is not supported.
 */
export interface SkillDirsEditorProps {
  backendId: string;
  dirs: string[];
  diagnostics: SkillLoadDiagnostic[];
  onSaved: () => void;
}

export function SkillDirsEditor({ backendId, dirs, diagnostics, onSaved }: SkillDirsEditorProps) {
  const [draftDirs, setDraftDirs] = useState<string[]>(dirs);
  const [newDirPath, setNewDirPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Mirrors the settings interaction: every add/remove immediately PUTs the
  // whole array — there is no separate explicit save step. `saving` guards
  // against overlapping PUTs from rapid clicks.
  const handleAddDir = async () => {
    const trimmed = newDirPath.trim();
    if (saving || !trimmed || draftDirs.includes(trimmed)) return;
    setSaving(true);
    setError(null);
    try {
      const updated = [...draftDirs, trimmed];
      await api.saveExternalSkillDirsForBackend(backendId, updated);
      setDraftDirs(updated);
      setNewDirPath('');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add directory');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveDir = async (dir: string) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const updated = draftDirs.filter(d => d !== dir);
      await api.saveExternalSkillDirsForBackend(backendId, updated);
      setDraftDirs(updated);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove directory');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">External Directories</h4>
      </div>
      <p className="text-xs text-muted-foreground">
        Directories with SKILL.md files are auto-discovered and available to agents through
        SearchSkills and LoadSkill.
      </p>

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p className="text-red-400 text-sm">{error}</p>
          <button
            onClick={() => setError(null)}
            className="text-xs text-red-400/70 hover:text-red-400 mt-1"
          >
            dismiss
          </button>
        </div>
      )}

      {draftDirs.length > 0 && (
        <div className="space-y-2">
          {draftDirs.map(dir => (
            <div
              key={dir}
              className="p-3 bg-secondary/50 rounded-lg border border-border/50 hover:border-border transition-colors flex items-center gap-3"
            >
              <svg
                className="w-4 h-4 text-muted-foreground shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                />
              </svg>
              <span className="text-sm font-mono truncate flex-1 min-w-0">{dir}</span>
              <button
                type="button"
                onClick={() => handleRemoveDir(dir)}
                disabled={saving}
                className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-red-400 disabled:opacity-50 transition-colors shrink-0"
                title="Remove"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          placeholder="/path/to/skills/directory"
          value={newDirPath}
          onChange={e => setNewDirPath(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAddDir()}
          className="flex-1 px-3 py-1.5 text-sm font-mono bg-secondary/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
        <button
          onClick={handleAddDir}
          disabled={saving || !newDirPath.trim()}
          className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground disabled:opacity-50 whitespace-nowrap transition-colors"
        >
          + Add
        </button>
      </div>

      {diagnostics.length > 0 && (
        <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-amber-300 text-sm font-medium">Skill diagnostics</p>
            <span className="text-xs text-amber-300/70">{diagnostics.length}</span>
          </div>
          <div className="space-y-1">
            {diagnostics.slice(0, 4).map((diagnostic, index) => (
              <div
                key={`${diagnostic.path}:${diagnostic.code}:${index}`}
                className="text-xs text-amber-100/90"
              >
                <span className="font-medium">{diagnostic.code}</span>
                <span className="text-amber-100/60"> ({diagnostic.source}) </span>
                <span>{diagnostic.message}</span>
                <div className="font-mono text-amber-100/50 truncate">{diagnostic.path}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
