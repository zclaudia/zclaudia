import { useState, useEffect, useRef } from 'react';
import * as api from '../../services/api';
import type { WorkspaceSkillInfo } from '../../services/api';
import { EditorSection } from './ui/EditorSection';
import { ProfileHeader } from './ui/ProfileHeader';
import type { DetailBadge } from './ui/DetailHeader';
import { useProfileAutosave } from './useProfileAutosave';
import { FIELD_CLASS } from '../../components/ui/Input';

/**
 * Backend-scoped skill editor.
 *
 * Matches the agent/LLM profile editor design language: it owns its own
 * full-height chrome (ProfileHeader breadcrumb + inline skill id + save
 * indicator) and autosaves on change (no explicit Create/Save button). The
 * skill id doubles as the record identity, so it is editable only in create
 * mode and frozen (read-only) once the skill exists.
 *
 * Parent must remount this component per identity — key it by
 * `${backendId}:${skill?.id ?? 'new'}`. Content loads on identity only;
 * prop-driven switching of backendId or same-id content updates without a
 * key change is not supported.
 */
export interface SkillEditorProps {
  backendId: string;
  /** null = create mode */
  skill: WorkspaceSkillInfo | null;
  /** Display name of the target backend, shown as a header badge. */
  backendName?: string;
  onBack: () => void;
  onSaved: (id: string) => void;
  onDeleted: () => void;
}

const CONTENT_PLACEHOLDER =
  '---\nname: My Skill\ndescription: What this skill does\n---\n\n# My Skill\n\nInstructions here...';

export function SkillEditor({
  backendId,
  skill,
  backendName,
  onBack,
  onSaved,
  onDeleted,
}: SkillEditorProps) {
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

  // Create mode form — the skill id lives in the header (ProfileHeader name).
  const [newSkillId, setNewSkillId] = useState('');

  const [pendingDelete, setPendingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deleteConfirmTimeoutRef = useRef<number | null>(null);
  // The persisted identity this editor targets — used so a create-mode autosave
  // switches to updates on subsequent edits instead of writing a second file.
  const savedIdRef = useRef<string | null>(skill?.id ?? null);

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

  const skillId = isCreate ? newSkillId.trim() : (skill?.id ?? '');

  // Autosave — enabled only once the form has hydrated (create: immediately;
  // edit: after the async content load lands, so hydrating the loaded content
  // isn't mistaken for a user edit). See useProfileAutosave's justEnabled path.
  const autosave = useProfileAutosave({
    enabled: isWorkspace && !loading,
    valid: Boolean(skillId && content.trim()),
    signature: JSON.stringify({ id: skillId, content }),
    save: async () => {
      setError(null);
      try {
        await api.saveWorkspaceSkillForBackend(backendId, skillId, content);
        savedIdRef.current = skillId;
        onSaved(skillId);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save skill');
        throw err;
      }
    },
  });

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

  const headerBadges: DetailBadge[] = [
    ...(backendName ? [{ label: backendName }] : []),
    ...(!isWorkspace ? [{ label: 'Read-only', tone: 'neutral' as const }] : []),
  ];

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <ProfileHeader
        crumb="Skills"
        onBack={onBack}
        name={isCreate ? newSkillId : (skill?.id ?? '')}
        onNameChange={setNewSkillId}
        onFieldBlur={autosave.flush}
        namePlaceholder="e.g. my-skill"
        badges={headerBadges}
        saveStatus={isWorkspace ? autosave.status : undefined}
        onRetry={autosave.retry}
        // The id is the record identity: editable only while creating.
        disabled={!isCreate}
      />

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 pb-4">
          {skill && <SkillInfoCard skill={skill} />}

          {error && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-4">
              <p className="text-sm text-destructive">{error}</p>
              <button
                onClick={() => setError(null)}
                className="mt-1 text-xs text-destructive/70 hover:text-destructive"
              >
                dismiss
              </button>
            </div>
          )}

          {!isWorkspace ? (
            <p className="text-xs text-muted-foreground">Managed by its source — read-only.</p>
          ) : loading ? (
            <p className="py-8 text-center text-muted-foreground">Loading…</p>
          ) : (
            <>
              <EditorSection title="SKILL.md">
                <textarea
                  aria-label="SKILL.md content"
                  placeholder={CONTENT_PLACEHOLDER}
                  value={content}
                  onChange={e => setContent(e.target.value)}
                  onBlur={autosave.flush}
                  className={`${FIELD_CLASS} h-80 resize-y font-mono`}
                  spellCheck={false}
                />
              </EditorSection>

              {!isCreate && (
                <div className="flex justify-end">
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className={`rounded-md border px-3 py-1.5 text-sm transition-colors disabled:opacity-50 ${
                      pendingDelete
                        ? 'border-destructive/30 bg-destructive/15 text-destructive hover:bg-destructive/25'
                        : 'border-border bg-background/70 text-destructive hover:bg-destructive/10'
                    }`}
                    title={pendingDelete ? 'Click again to confirm delete' : 'Delete'}
                  >
                    {deleting ? 'Deleting…' : pendingDelete ? 'Confirm delete' : 'Delete'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
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
