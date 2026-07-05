import { useState, useEffect, useRef } from 'react';
import * as api from '../../services/api';
import type { WorkspaceSkillInfo } from '../../services/api';

/**
 * Parent must remount this component per identity — key it by
 * `${backendId}:${skill?.id ?? 'new'}`. Content loads on identity only;
 * prop-driven switching of backendId or same-id content updates without a
 * key change is not supported.
 */
export interface SkillEditorProps {
  backendId: string;
  /** null = create mode */
  skill: WorkspaceSkillInfo | null;
  onSaved: (id: string) => void;
  onDeleted: () => void;
}

export function SkillEditor({ backendId, skill, onSaved, onDeleted }: SkillEditorProps) {
  const isCreate = skill === null;
  const source = skill?.source ?? 'workspace';
  // Workspace-source skills (and create mode) are editable; external/plugin
  // skills are managed by their source. The server's GET /skills/:skillId
  // only reads from the workspace skills dir (workspaceService.loadSkill),
  // so content can't even be fetched for non-workspace skills.
  const isWorkspace = isCreate || source === 'workspace';

  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(!isCreate && isWorkspace);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Create mode form
  const [newSkillId, setNewSkillId] = useState('');

  const [pendingDelete, setPendingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deleteConfirmTimeoutRef = useRef<number | null>(null);

  const clearDeleteConfirmation = () => {
    if (deleteConfirmTimeoutRef.current !== null) {
      window.clearTimeout(deleteConfirmTimeoutRef.current);
      deleteConfirmTimeoutRef.current = null;
    }
    setPendingDelete(false);
  };

  useEffect(() => {
    return () => {
      if (deleteConfirmTimeoutRef.current !== null) {
        window.clearTimeout(deleteConfirmTimeoutRef.current);
      }
    };
  }, []);

  // Edit mode (workspace skills only): load the SKILL.md content.
  useEffect(() => {
    if (isCreate || !isWorkspace || !skill) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await api.getWorkspaceSkillForBackend(backendId, skill.id);
        if (!cancelled) setContent(result.content);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load skill');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendId, skill?.id]);

  const handleSave = async () => {
    const skillId = isCreate ? newSkillId.trim() : skill!.id;
    if (!skillId || !content.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.saveWorkspaceSkillForBackend(backendId, skillId, content);
      onSaved(skillId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save skill');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!skill || deleting) return;

    if (!pendingDelete) {
      clearDeleteConfirmation();
      setPendingDelete(true);
      deleteConfirmTimeoutRef.current = window.setTimeout(() => {
        setPendingDelete(false);
        deleteConfirmTimeoutRef.current = null;
      }, 3000);
      return;
    }

    clearDeleteConfirmation();
    setDeleting(true);
    setError(null);
    try {
      await api.deleteWorkspaceSkillForBackend(backendId, skill.id);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete skill');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      {skill && <SkillInfoCard skill={skill} />}

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

      {!isWorkspace ? (
        <p className="text-xs text-muted-foreground">Managed by its source — read-only.</p>
      ) : isCreate ? (
        <div className="bg-secondary/50 border border-border/50 rounded-lg p-4 space-y-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Skill ID *</label>
            <input
              type="text"
              placeholder="e.g. my-skill"
              value={newSkillId}
              onChange={e => setNewSkillId(e.target.value)}
              className="w-full px-3 py-1.5 text-sm bg-secondary/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono"
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">SKILL.md Content *</label>
            <textarea
              placeholder={
                '---\nname: My Skill\ndescription: What this skill does\n---\n\n# My Skill\n\nInstructions here...'
              }
              value={content}
              onChange={e => setContent(e.target.value)}
              className="w-full h-40 px-3 py-2 text-sm font-mono bg-secondary/50 border border-border rounded-lg resize-y focus:outline-none focus:ring-2 focus:ring-primary/50"
              spellCheck={false}
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={handleSave}
              disabled={!newSkillId.trim() || !content.trim() || saving}
              className="px-3 py-1.5 text-sm bg-muted/60 text-foreground rounded-lg hover:bg-muted disabled:opacity-50 transition-colors"
            >
              {saving ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      ) : loading ? (
        <p className="text-muted-foreground text-center py-8">Loading...</p>
      ) : (
        <div className="bg-secondary/50 border border-border/50 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg
                className="w-4 h-4 text-muted-foreground"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                />
              </svg>
              <span className="font-medium text-sm">{skill!.id}</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleDelete}
                disabled={deleting}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors disabled:opacity-50 ${
                  pendingDelete
                    ? 'bg-destructive/15 text-destructive hover:bg-destructive/25'
                    : 'bg-secondary text-destructive hover:bg-secondary/80'
                }`}
                title={pendingDelete ? 'Click again to confirm delete' : 'Delete'}
              >
                {deleting ? 'Deleting...' : pendingDelete ? 'Confirm delete' : 'Delete'}
              </button>
              <button
                onClick={handleSave}
                disabled={!content.trim() || saving}
                className="px-3 py-1.5 text-sm bg-muted/60 text-foreground rounded-lg hover:bg-muted disabled:opacity-50 transition-colors"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            className="w-full h-80 px-3 py-2 text-sm font-mono bg-secondary/50 border border-border rounded-lg resize-y focus:outline-none focus:ring-2 focus:ring-primary/50"
            spellCheck={false}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Read-only skill info header — name, badges, description, and metadata
 * tags, copied from the settings skill list-item card.
 */
function SkillInfoCard({ skill }: { skill: WorkspaceSkillInfo }) {
  const source = skill.source ?? 'workspace';
  const isWorkspace = source === 'workspace';
  const displayName = skill.name || skill.id;
  const displayDesc = skill.description || '';
  const isEligible = skill.eligible !== false;
  const requirementSummary = [
    skill.requirements?.os?.length ? `os: ${skill.requirements.os.join(', ')}` : '',
    skill.requirements?.binaries?.length ? `bin: ${skill.requirements.binaries.join(', ')}` : '',
    skill.requirements?.env?.length ? `env: ${skill.requirements.env.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join(' | ');

  return (
    <div className="p-3 bg-secondary/50 rounded-lg border border-border/50">
      <div className="flex items-center gap-2">
        <span className="font-medium text-sm truncate">{displayName}</span>
        <span
          className={`px-1.5 py-0.5 rounded-md text-[10px] font-medium ${
            isEligible ? 'bg-green-500/20 text-green-400' : 'bg-destructive/20 text-destructive'
          }`}
        >
          {isEligible ? 'Eligible' : 'Blocked'}
        </span>
        <span
          className={`px-1.5 py-0.5 rounded-md text-[10px] font-medium ${
            isWorkspace ? 'bg-blue-500/10 text-blue-400' : 'bg-purple-500/10 text-purple-400'
          }`}
        >
          {source[0].toUpperCase() + source.slice(1)}
        </span>
      </div>
      <p className="text-xs text-muted-foreground truncate mt-0.5">{displayDesc}</p>
      {skill.metadata?.whenToUse && (
        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
          When: {skill.metadata.whenToUse}
        </p>
      )}
      {(skill.metadata?.allowedTools?.length ||
        skill.metadata?.paths?.length ||
        skill.metadata?.arguments?.length ||
        skill.metadata?.argumentHint ||
        skill.metadata?.snippets?.length ||
        skill.metadata?.shellSnippets?.length ||
        skill.metadata?.hookTriggers?.tools?.length ||
        skill.metadata?.hookTriggers?.paths?.length ||
        requirementSummary) && (
        <div className="mt-1 flex flex-wrap gap-1">
          {skill.metadata?.argumentHint && (
            <span className="px-1.5 py-0.5 rounded bg-muted/60 text-[10px] text-primary">
              args {skill.metadata.argumentHint}
            </span>
          )}
          {skill.metadata?.arguments?.length && !skill.metadata.argumentHint ? (
            <span className="px-1.5 py-0.5 rounded bg-muted/60 text-[10px] text-primary">
              args {skill.metadata.arguments.join(' ')}
            </span>
          ) : null}
          {skill.metadata?.allowedTools?.map(tool => (
            <span
              key={`tool:${tool}`}
              className="px-1.5 py-0.5 rounded bg-secondary text-[10px] text-muted-foreground"
            >
              {tool}
            </span>
          ))}
          {skill.metadata?.paths?.map(skillPath => (
            <span
              key={`path:${skillPath}`}
              className="px-1.5 py-0.5 rounded bg-secondary text-[10px] text-muted-foreground font-mono"
            >
              {skillPath}
            </span>
          ))}
          {skill.metadata?.snippets?.map(snippet => (
            <span
              key={`snippet:${snippet}`}
              className="px-1.5 py-0.5 rounded bg-muted/60 text-[10px] text-primary"
            >
              snippet {snippet}
            </span>
          ))}
          {skill.metadata?.shellSnippets?.map(snippet => (
            <span
              key={`shell:${snippet}`}
              className="px-1.5 py-0.5 rounded bg-secondary text-[10px] text-muted-foreground font-mono"
            >
              shell {snippet}
            </span>
          ))}
          {skill.metadata?.hookTriggers?.tools?.map(tool => (
            <span
              key={`hook-tool:${tool}`}
              className="px-1.5 py-0.5 rounded bg-purple-500/10 text-[10px] text-purple-300"
            >
              hook tool {tool}
            </span>
          ))}
          {skill.metadata?.hookTriggers?.paths?.map(skillPath => (
            <span
              key={`hook-path:${skillPath}`}
              className="px-1.5 py-0.5 rounded bg-purple-500/10 text-[10px] text-purple-300 font-mono"
            >
              hook path {skillPath}
            </span>
          ))}
          {requirementSummary && (
            <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-[10px] text-amber-300">
              requires {requirementSummary}
            </span>
          )}
        </div>
      )}
      <p className="text-xs text-muted-foreground/50 font-mono mt-0.5">
        {source}/{skill.id}
      </p>
    </div>
  );
}
