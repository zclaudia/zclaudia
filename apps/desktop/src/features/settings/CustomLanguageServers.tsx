import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { LanguageServerConfig } from '@zclaudia/shared/core/language-servers';
import { getCustomLanguageServers, setCustomLanguageServers } from '../../services/api';
import { Button, IconButton } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { FIELD_CLASS, Input } from '../../components/ui/Input';
import {
  BUILT_IN_SERVER_IDS,
  EMPTY_DRAFT,
  configFromDraft,
  draftFromConfig,
  slugify,
  type CustomServerDraft,
} from './customLanguageServerForm';

/**
 * The user's own language servers (clangd, lua-language-server, …): what to
 * run, for which files, in which workspaces. Commands run on the target
 * backend's machine, like any command the user starts there.
 */
export function CustomLanguageServers({
  backendId,
  onSaved,
}: {
  backendId: string | null;
  /** Called after a save, so the server list can refresh. */
  onSaved?: () => void;
}) {
  const [servers, setServers] = useState<LanguageServerConfig[] | null>(null);
  const [editing, setEditing] = useState<{ index: number | null; draft: CustomServerDraft } | null>(
    null
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setServers((await getCustomLanguageServers(backendId)).servers);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load custom servers');
    }
  }, [backendId]);

  useEffect(() => {
    if (backendId) void load();
  }, [backendId, load]);

  const save = async (next: LanguageServerConfig[]) => {
    setSaving(true);
    try {
      setServers((await setCustomLanguageServers(next, backendId)).servers);
      setError(null);
      setEditing(null);
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save custom servers');
    } finally {
      setSaving(false);
    }
  };

  const submit = () => {
    if (!editing || !servers) return;
    const result = configFromDraft(editing.draft);
    if (result.errors) {
      setFieldErrors(result.errors);
      return;
    }
    const duplicate = servers.some(
      (server, index) => server.id === result.config.id && index !== editing.index
    );
    if (duplicate) {
      setFieldErrors({ id: `Another custom server already uses the id "${result.config.id}"` });
      return;
    }
    setFieldErrors({});
    const next = [...servers];
    if (editing.index === null) next.push(result.config);
    else next[editing.index] = result.config;
    void save(next);
  };

  const update = (patch: Partial<CustomServerDraft>) =>
    setEditing(current =>
      current ? { ...current, draft: { ...current.draft, ...patch } } : current
    );

  if (!servers) {
    return error ? (
      <p className="text-xs text-destructive" role="alert">
        {error}
      </p>
    ) : null;
  }

  return (
    <div className="space-y-3" data-testid="custom-language-servers">
      {servers.length > 0 && (
        <ul className="space-y-1.5">
          {servers.map((server, index) => (
            <li key={server.id} className="flex items-center gap-2 text-xs">
              <span className="text-foreground">{server.name}</span>
              <span
                className="truncate font-mono text-2xs text-muted-foreground"
                title={server.command}
              >
                {server.command}
              </span>
              <span className="truncate text-muted-foreground">
                {Object.keys(server.extensions).join(' ')}
              </span>
              <span className="ml-auto flex flex-shrink-0 items-center">
                <IconButton
                  size="sm"
                  aria-label={`Edit ${server.name}`}
                  onClick={() => {
                    setFieldErrors({});
                    setEditing({ index, draft: draftFromConfig(server) });
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                </IconButton>
                <IconButton
                  size="sm"
                  aria-label={`Remove ${server.name}`}
                  disabled={saving}
                  onClick={() => void save(servers.filter((_, i) => i !== index))}
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                </IconButton>
              </span>
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <div
          className="space-y-3 rounded-lg border border-border p-3"
          data-testid="custom-server-editor"
        >
          <div className="grid items-end gap-3 md:grid-cols-2">
            <FormField label="Name" required error={fieldErrors.name}>
              {props => (
                <Input
                  {...props}
                  value={editing.draft.name}
                  placeholder="C (clangd)"
                  onChange={e =>
                    update({
                      name: e.target.value,
                      // A new server's id follows its name until edited by hand.
                      ...(editing.index === null && editing.draft.id === slugify(editing.draft.name)
                        ? { id: slugify(e.target.value) }
                        : {}),
                    })
                  }
                />
              )}
            </FormField>
            <FormField
              label="Id"
              required
              error={fieldErrors.id}
              description={`Use ${BUILT_IN_SERVER_IDS.join(', ')} to replace a built-in server.`}
            >
              {props => (
                <Input
                  {...props}
                  value={editing.draft.id}
                  placeholder="clangd"
                  onChange={e => update({ id: e.target.value })}
                />
              )}
            </FormField>
            <FormField
              label="Command"
              required
              error={fieldErrors.command}
              description="An absolute path, or a name found on PATH."
            >
              {props => (
                <Input
                  {...props}
                  className="font-mono"
                  value={editing.draft.command}
                  placeholder="clangd"
                  onChange={e => update({ command: e.target.value })}
                />
              )}
            </FormField>
            <FormField label="Arguments" description="Separated by spaces.">
              {props => (
                <Input
                  {...props}
                  className="font-mono"
                  value={editing.draft.args}
                  placeholder="--background-index"
                  onChange={e => update({ args: e.target.value })}
                />
              )}
            </FormField>
            <FormField
              label="File extensions"
              required
              error={fieldErrors.extensions}
              description="Add =id when the language id differs, e.g. .c .cpp=cpp .h=c"
            >
              {props => (
                <Input
                  {...props}
                  className="font-mono"
                  value={editing.draft.extensions}
                  placeholder=".c .h=c"
                  onChange={e => update({ extensions: e.target.value })}
                />
              )}
            </FormField>
            <FormField
              label="Root markers"
              required
              error={fieldErrors.rootMarkers}
              description="Files that mark a workspace for this server."
            >
              {props => (
                <Input
                  {...props}
                  className="font-mono"
                  value={editing.draft.rootMarkers}
                  placeholder="compile_commands.json"
                  onChange={e => update({ rootMarkers: e.target.value })}
                />
              )}
            </FormField>
          </div>
          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground">Advanced</summary>
            <div className="mt-2 grid gap-3 md:grid-cols-2">
              <FormField
                label="Initialization options (JSON)"
                error={fieldErrors.initializationOptions}
              >
                {props => (
                  <textarea
                    {...props}
                    rows={4}
                    className={`${FIELD_CLASS} font-mono text-xs`}
                    value={editing.draft.initializationOptions}
                    onChange={e => update({ initializationOptions: e.target.value })}
                  />
                )}
              </FormField>
              <FormField
                label="Settings (JSON)"
                error={fieldErrors.settings}
                description="Returned for the server's configuration requests, by section."
              >
                {props => (
                  <textarea
                    {...props}
                    rows={4}
                    className={`${FIELD_CLASS} font-mono text-xs`}
                    value={editing.draft.settings}
                    onChange={e => update({ settings: e.target.value })}
                  />
                )}
              </FormField>
            </div>
          </details>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setFieldErrors({});
            setEditing({ index: null, draft: EMPTY_DRAFT });
          }}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
          Add server
        </Button>
      )}

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
