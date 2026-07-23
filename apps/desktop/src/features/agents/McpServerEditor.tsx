/**
 * Backend-scoped MCP server editor
 *
 * Standalone create/edit form + connection actions for one MCP server on one
 * backend, extracted from the old settings MCP Servers tab's monolith. Talks to
 * the ForBackend API variants directly — no global store.
 *
 * Matches the agent/LLM profile editor design language: it owns its own
 * full-height chrome (ProfileHeader breadcrumb + inline-editable name/description
 * + save indicator) and autosaves on change (no explicit Add/Save button),
 * laying fields out as EditorSection cards. Delete lives in the header "⋯"
 * menu; the other connection lifecycle actions (connect/disconnect/refresh/
 * oauth/toggle) live in a Connection section.
 *
 * Parent must remount this component per identity — key it by
 * `${backendId}:${server?.id ?? 'new'}`. Form state initializes from the
 * `server` prop on mount only; prop-driven switching of backendId or server
 * without a key change is not supported.
 *
 * Deliberately not carried over from the old settings tab's component: readOnly
 * mode, the search bar, stats cards, list rows, the (now-deleted) mcpServerStore,
 * and the expandable inventory browser (tools/resources/prompts details — deferred).
 */

import { useState, useCallback, useMemo, useRef } from 'react';
import {
  connectMcpServerForBackend,
  createMcpServerForBackend,
  deleteMcpServerForBackend,
  disconnectMcpServerForBackend,
  refreshMcpServerForBackend,
  signOutMcpOAuthForBackend,
  startMcpOAuthForBackend,
  toggleMcpServerForBackend,
  updateMcpServerForBackend,
} from '../../services/api';
import type { McpOAuthStartResult } from '../../services/api';
import { McpOAuthLoginModal } from './McpOAuthLoginModal';
import { EditorSection, FieldLabel } from './ui/EditorSection';
import { ProfileHeader } from './ui/ProfileHeader';
import type { DetailBadge } from './ui/DetailHeader';
import type { ActionsMenuAction } from './ui/ActionsMenu';
import { useProfileAutosave } from './useProfileAutosave';
import { FormField } from '../../components/ui/FormField';
import { Input, FIELD_CLASS } from '../../components/ui/Input';
import { Toggle } from '../../components/ui/Toggle';
import { confirm } from '../../stores/confirmDialogStore';
import type { McpServerConfig, McpServerStatus } from '@zclaudia/shared';
import type {
  McpRiskAction,
  McpServerTransport,
  McpServerTrustLevel,
  McpServerTrustPolicy,
} from '@zclaudia/shared/core/mcp';

const PROVIDER_OPTIONS = [{ value: 'zclaudia', label: 'ZClaudia' }];

const RISK_ACTION_OPTIONS: Array<{ value: McpRiskAction | ''; label: string }> = [
  { value: '', label: 'Use default' },
  { value: 'auto-approve', label: 'Auto approve' },
  { value: 'ask', label: 'Ask' },
  { value: 'deny', label: 'Deny' },
];

export interface McpServerEditorProps {
  backendId: string;
  /** null = create mode */
  server: McpServerConfig | null;
  status: McpServerStatus | undefined;
  /** Display name of the target backend, shown as a header badge. */
  backendName?: string;
  onBack: () => void;
  onSaved: (id: string) => void;
  onDeleted: () => void;
  /** Connection-state actions changed something (connect/disconnect/refresh/toggle/oauth) — parent refetches. */
  onStatusChanged: () => void;
}

const GLYPH_ORANGE_TEXT = 'text-[hsl(var(--glyph-orange))]';

const statusBadgeClass = (state?: string) => {
  if (state === 'connected') return 'bg-success/20 text-success';
  if (state === 'failed') return 'bg-destructive/20 text-destructive';
  if (state === 'needs-auth') return `bg-[hsl(var(--glyph-orange)/0.2)] ${GLYPH_ORANGE_TEXT}`;
  if (state === 'connecting') return 'bg-warning/20 text-warning';
  if (state === 'disabled') return 'bg-muted text-muted-foreground';
  return 'bg-primary/10 text-primary';
};

export function McpServerEditor({
  backendId,
  server,
  status,
  backendName,
  onBack,
  onSaved,
  onDeleted,
  onStatusChanged,
}: McpServerEditorProps) {
  // Form state — initialized from `server` (keyed remount contract).
  const [formName, setFormName] = useState(server?.name ?? '');
  const [formTransport, setFormTransport] = useState<McpServerTransport>(
    server?.transport ?? 'stdio'
  );
  const [formCommand, setFormCommand] = useState(server?.command ?? '');
  const [formUrl, setFormUrl] = useState(server?.url || '');
  const [formArgs, setFormArgs] = useState(server?.args?.join(' ') || '');
  const [formEnvPairs, setFormEnvPairs] = useState<{ key: string; value: string }[]>(
    server?.env ? Object.entries(server.env).map(([key, value]) => ({ key, value })) : []
  );
  const [formHeaderPairs, setFormHeaderPairs] = useState<{ key: string; value: string }[]>(
    server?.headers ? Object.entries(server.headers).map(([key, value]) => ({ key, value })) : []
  );
  const [formHeadersHelper, setFormHeadersHelper] = useState(server?.headersHelper || '');
  const [formDescription, setFormDescription] = useState(server?.description || '');
  const [formOAuthEnabled, setFormOAuthEnabled] = useState(server?.oauthConfig?.enabled ?? false);
  const [formOAuthMetadataUrl, setFormOAuthMetadataUrl] = useState(
    server?.oauthConfig?.metadataUrl ?? ''
  );
  const [formOAuthAuthorizationEndpoint, setFormOAuthAuthorizationEndpoint] = useState(
    server?.oauthConfig?.authorizationEndpoint ?? ''
  );
  const [formOAuthTokenEndpoint, setFormOAuthTokenEndpoint] = useState(
    server?.oauthConfig?.tokenEndpoint ?? ''
  );
  const [formOAuthDeviceEndpoint, setFormOAuthDeviceEndpoint] = useState(
    server?.oauthConfig?.deviceAuthorizationEndpoint ?? ''
  );
  const [formOAuthClientId, setFormOAuthClientId] = useState(server?.oauthConfig?.clientId ?? '');
  const [formOAuthClientSecret, setFormOAuthClientSecret] = useState(
    server?.oauthConfig?.clientSecret ?? ''
  );
  const [formOAuthScopes, setFormOAuthScopes] = useState(
    server?.oauthConfig?.scopes?.join(' ') ?? ''
  );
  const [formScope, setFormScope] = useState<string[]>(server?.providerScope || []);
  const [formTrustLevel, setFormTrustLevel] = useState<McpServerTrustLevel>(
    server?.trustPolicy?.trustLevel ?? 'untrusted'
  );
  const [formTrustReadOnlyHint, setFormTrustReadOnlyHint] = useState(
    server?.trustPolicy?.trustReadOnlyHint ?? false
  );
  const [formDefaultRiskAction, setFormDefaultRiskAction] = useState<McpRiskAction>(
    server?.trustPolicy?.defaultRiskAction ?? 'ask'
  );
  const [formRiskActions, setFormRiskActions] = useState<
    Partial<Record<'low' | 'medium' | 'high', McpRiskAction>>
  >(server?.trustPolicy?.riskActions ?? {});
  const [saveError, setSaveError] = useState<string | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);
  const [oauthLogin, setOauthLogin] = useState<{ session: McpOAuthStartResult } | null>(null);
  const [startingOAuth, setStartingOAuth] = useState(false);

  const [deleting, setDeleting] = useState(false);
  // The persisted identity this editor targets — so a create-mode autosave
  // switches to updates on subsequent edits instead of creating a duplicate.
  const savedIdRef = useRef<string | null>(server?.id ?? null);

  // Whole-form validity gate for autosave: name + the transport's required
  // endpoint. While invalid, edits are held (save-state shows "Not saved").
  const formValid = useMemo(
    () =>
      Boolean(
        formName.trim() &&
          (formTransport === 'stdio' ? formCommand.trim() : formUrl.trim())
      ),
    [formName, formTransport, formCommand, formUrl]
  );

  const autosaveSignature = useMemo(
    () =>
      JSON.stringify({
        name: formName,
        transport: formTransport,
        command: formCommand,
        url: formUrl,
        args: formArgs,
        envPairs: formEnvPairs,
        headerPairs: formHeaderPairs,
        headersHelper: formHeadersHelper,
        description: formDescription,
        oauthEnabled: formOAuthEnabled,
        oauthMetadataUrl: formOAuthMetadataUrl,
        oauthAuthorizationEndpoint: formOAuthAuthorizationEndpoint,
        oauthTokenEndpoint: formOAuthTokenEndpoint,
        oauthDeviceEndpoint: formOAuthDeviceEndpoint,
        oauthClientId: formOAuthClientId,
        oauthClientSecret: formOAuthClientSecret,
        oauthScopes: formOAuthScopes,
        scope: formScope,
        trustLevel: formTrustLevel,
        trustReadOnlyHint: formTrustReadOnlyHint,
        defaultRiskAction: formDefaultRiskAction,
        riskActions: formRiskActions,
      }),
    [
      formName,
      formTransport,
      formCommand,
      formUrl,
      formArgs,
      formEnvPairs,
      formHeaderPairs,
      formHeadersHelper,
      formDescription,
      formOAuthEnabled,
      formOAuthMetadataUrl,
      formOAuthAuthorizationEndpoint,
      formOAuthTokenEndpoint,
      formOAuthDeviceEndpoint,
      formOAuthClientId,
      formOAuthClientSecret,
      formOAuthScopes,
      formScope,
      formTrustLevel,
      formTrustReadOnlyHint,
      formDefaultRiskAction,
      formRiskActions,
    ]
  );

  const persist = useCallback(async () => {
    const args = formArgs.trim() ? formArgs.trim().split(/\s+/) : undefined;
    const env =
      formEnvPairs.filter(p => p.key.trim()).length > 0
        ? Object.fromEntries(formEnvPairs.filter(p => p.key.trim()).map(p => [p.key, p.value]))
        : undefined;
    const headers =
      formHeaderPairs.filter(p => p.key.trim()).length > 0
        ? Object.fromEntries(formHeaderPairs.filter(p => p.key.trim()).map(p => [p.key, p.value]))
        : undefined;
    const headersHelper =
      formTransport !== 'stdio' && formHeadersHelper.trim() ? formHeadersHelper.trim() : undefined;
    const oauthConfig = formOAuthEnabled
      ? {
          enabled: true,
          metadataUrl: formOAuthMetadataUrl.trim() || undefined,
          authorizationEndpoint: formOAuthAuthorizationEndpoint.trim() || undefined,
          tokenEndpoint: formOAuthTokenEndpoint.trim() || undefined,
          deviceAuthorizationEndpoint: formOAuthDeviceEndpoint.trim() || undefined,
          clientId: formOAuthClientId.trim() || undefined,
          clientSecret: formOAuthClientSecret || undefined,
          scopes: formOAuthScopes.trim() ? formOAuthScopes.trim().split(/\s+/) : undefined,
        }
      : undefined;
    const trustPolicy: McpServerTrustPolicy = {
      trustLevel: formTrustLevel,
      trustReadOnlyHint: formTrustReadOnlyHint,
      defaultRiskAction: formDefaultRiskAction,
      riskActions: Object.fromEntries(
        Object.entries(formRiskActions).filter(
          (entry): entry is ['low' | 'medium' | 'high', McpRiskAction] => !!entry[1]
        )
      ),
    };

    setSaveError(null);
    try {
      const targetId = savedIdRef.current;
      if (targetId) {
        const updated = await updateMcpServerForBackend(backendId, targetId, {
          name: formName.trim(),
          command: formTransport === 'stdio' ? formCommand.trim() : '',
          transport: formTransport,
          url: formTransport !== 'stdio' ? formUrl.trim() : undefined,
          args: args || [],
          env: env || {},
          headers: headers || {},
          headersHelper,
          oauthConfig,
          description: formDescription.trim() || undefined,
          providerScope: formScope.length > 0 ? formScope : undefined,
          trustPolicy,
        });
        savedIdRef.current = updated.id;
        onSaved(updated.id);
      } else {
        const created = await createMcpServerForBackend(backendId, {
          name: formName.trim(),
          command: formTransport === 'stdio' ? formCommand.trim() : '',
          transport: formTransport,
          url: formTransport !== 'stdio' ? formUrl.trim() : undefined,
          args: formTransport === 'stdio' ? args : undefined,
          env: formTransport === 'stdio' ? env : undefined,
          headers,
          headersHelper,
          oauthConfig,
          description: formDescription.trim() || undefined,
          providerScope: formScope.length > 0 ? formScope : undefined,
          trustPolicy,
        });
        savedIdRef.current = created.id;
        onSaved(created.id);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, [
    formName,
    formTransport,
    formCommand,
    formUrl,
    formArgs,
    formEnvPairs,
    formHeaderPairs,
    formHeadersHelper,
    formDescription,
    formOAuthEnabled,
    formOAuthMetadataUrl,
    formOAuthAuthorizationEndpoint,
    formOAuthTokenEndpoint,
    formOAuthDeviceEndpoint,
    formOAuthClientId,
    formOAuthClientSecret,
    formOAuthScopes,
    formScope,
    formTrustLevel,
    formTrustReadOnlyHint,
    formDefaultRiskAction,
    formRiskActions,
    backendId,
    onSaved,
  ]);

  const autosave = useProfileAutosave({
    enabled: true,
    valid: formValid,
    signature: autosaveSignature,
    save: persist,
  });

  /** Run a connection-state action, then notify the parent to refetch. */
  const runAction = useCallback(
    async (action: () => Promise<unknown>) => {
      setActionError(null);
      try {
        await action();
        onStatusChanged();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
      }
    },
    [onStatusChanged]
  );

  const handleOAuthLogin = useCallback(
    async (method: 'browser' | 'device_code') => {
      if (!server || startingOAuth) return;
      setStartingOAuth(true);
      setActionError(null);
      try {
        const session = await startMcpOAuthForBackend(backendId, server.name, method);
        if (session.method === 'browser') {
          window.open(session.authUrl, '_blank', 'noopener,noreferrer');
        }
        setOauthLogin({ session });
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
      } finally {
        setStartingOAuth(false);
      }
    },
    [backendId, server, startingOAuth]
  );

  const handleOAuthSuccess = useCallback(() => {
    if (!server) return;
    setOauthLogin(null);
    void runAction(() => refreshMcpServerForBackend(backendId, server.name));
  }, [backendId, server, runAction]);

  const handleDelete = async () => {
    if (!server || deleting) return;

    const ok = await confirm({
      title: 'Delete MCP server?',
      message: `"${server.name ?? server.id}" will be permanently deleted.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;

    setDeleting(true);
    setActionError(null);
    try {
      await deleteMcpServerForBackend(backendId, server.id);
      onDeleted();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  const toggleScope = useCallback((provider: string) => {
    setFormScope(prev =>
      prev.includes(provider) ? prev.filter(p => p !== provider) : [...prev, provider]
    );
  }, []);

  const setRiskAction = useCallback(
    (level: 'low' | 'medium' | 'high', action: McpRiskAction | '') => {
      setFormRiskActions(prev => {
        const next = { ...prev };
        if (action) next[level] = action;
        else delete next[level];
        return next;
      });
    },
    []
  );

  const state = status?.state ?? (server?.enabled ? 'configured' : 'disabled');
  const hasOAuthCredentials = Boolean(
    server?.oauthCredentials?.hasAccessToken || server?.oauthCredentials?.accessToken
  );

  const renderConnectionSection = (current: McpServerConfig) => (
    <EditorSection title="Connection">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`px-1.5 py-0.5 rounded-md text-[10px] font-medium ${
            current.enabled ? 'bg-success/20 text-success' : 'bg-muted text-muted-foreground'
          }`}
        >
          {current.enabled ? 'Enabled' : 'Disabled'}
        </span>
        <span
          className={`px-1.5 py-0.5 rounded-md text-[10px] font-medium ${statusBadgeClass(state)}`}
        >
          {state}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {current.enabled && (
            <>
              <button
                type="button"
                onClick={() =>
                  void runAction(() => connectMcpServerForBackend(backendId, current.name))
                }
                className="rounded-md border border-border bg-background/70 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                title="Connect"
              >
                Connect
              </button>
              <button
                type="button"
                onClick={() =>
                  void runAction(() => disconnectMcpServerForBackend(backendId, current.name))
                }
                className="rounded-md border border-border bg-background/70 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                title="Disconnect"
              >
                Disconnect
              </button>
              <button
                type="button"
                onClick={() =>
                  void runAction(() => refreshMcpServerForBackend(backendId, current.name))
                }
                className="rounded-md border border-border bg-background/70 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                title="Refresh inventory"
              >
                Refresh
              </button>
              {(current.transport === 'streamable-http' || current.transport === 'sse') &&
              current.oauthConfig?.enabled ? (
                <>
                  <button
                    type="button"
                    onClick={() => void handleOAuthLogin('browser')}
                    disabled={startingOAuth}
                    className={`rounded-md border border-[hsl(var(--glyph-orange)/0.3)] bg-[hsl(var(--glyph-orange)/0.15)] px-2.5 py-1 text-xs ${GLYPH_ORANGE_TEXT} transition-colors hover:bg-[hsl(var(--glyph-orange)/0.25)] disabled:opacity-50`}
                    title="Start MCP OAuth login"
                  >
                    OAuth Login
                  </button>
                  {current.oauthConfig.deviceAuthorizationEndpoint && (
                    <button
                      type="button"
                      onClick={() => void handleOAuthLogin('device_code')}
                      disabled={startingOAuth}
                      className={`rounded-md border border-[hsl(var(--glyph-orange)/0.25)] bg-[hsl(var(--glyph-orange)/0.1)] px-2.5 py-1 text-xs ${GLYPH_ORANGE_TEXT} transition-colors hover:bg-[hsl(var(--glyph-orange)/0.2)] disabled:opacity-50`}
                      title="Start MCP OAuth device-code login"
                    >
                      Device Login
                    </button>
                  )}
                  {hasOAuthCredentials && (
                    <button
                      type="button"
                      onClick={() =>
                        void runAction(() => signOutMcpOAuthForBackend(backendId, current.name))
                      }
                      className="rounded-md border border-border bg-background/70 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                      title="Sign out of MCP OAuth"
                    >
                      Sign out
                    </button>
                  )}
                </>
              ) : (
                (state === 'needs-auth' || status?.authRequired) && (
                  <button
                    type="button"
                    onClick={() =>
                      void runAction(() => refreshMcpServerForBackend(backendId, current.name))
                    }
                    className={`rounded-md border border-[hsl(var(--glyph-orange)/0.3)] bg-[hsl(var(--glyph-orange)/0.15)] px-2.5 py-1 text-xs ${GLYPH_ORANGE_TEXT} transition-colors hover:bg-[hsl(var(--glyph-orange)/0.25)]`}
                    title="Refresh after updating MCP credentials"
                  >
                    Authenticate
                  </button>
                )
              )}
            </>
          )}
          <Toggle
            checked={current.enabled}
            onChange={() => void runAction(() => toggleMcpServerForBackend(backendId, current.id))}
            aria-label={current.enabled ? 'Disable' : 'Enable'}
          />
        </div>
      </div>
      {actionError && <p className="mt-2 text-xs text-destructive">{actionError}</p>}
    </EditorSection>
  );

  // Enabled/Disabled is now surfaced by the header StatusChip (disabled) and the
  // Connection section (full detail) — no separate header badge, to avoid a
  // duplicate "Disabled" label next to the chip.
  const headerBadges: DetailBadge[] = [...(backendName ? [{ label: backendName }] : [])];

  const headerActions: ActionsMenuAction[] | undefined = server
    ? [
        {
          label: 'Delete server',
          onSelect: () => void handleDelete(),
          destructive: true,
          disabled: deleting,
        },
      ]
    : undefined;

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <ProfileHeader
        crumb="MCP Servers"
        onBack={onBack}
        name={formName}
        onNameChange={setFormName}
        onFieldBlur={autosave.flush}
        namePlaceholder="e.g. filesystem"
        description={formDescription}
        onDescriptionChange={setFormDescription}
        badges={headerBadges}
        saveStatus={autosave.status}
        onRetry={autosave.retry}
        recordStatus={server?.recordStatus}
        actions={headerActions}
      />
      {saveError && <p className="px-4 pb-2 text-xs text-destructive">{saveError}</p>}

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 pb-4">
          {server && renderConnectionSection(server)}

          <EditorSection title="Configuration">
            <div>
              <FieldLabel htmlFor="mcp-transport">Transport</FieldLabel>
              <select
                id="mcp-transport"
                aria-label="Transport"
                value={formTransport}
                onChange={e => setFormTransport(e.target.value as McpServerTransport)}
                className={FIELD_CLASS}
              >
                <option value="stdio">stdio</option>
                <option value="streamable-http">streamable-http</option>
                <option value="sse">sse</option>
              </select>
            </div>

            {formTransport === 'stdio' ? (
              <>
                <FormField label="Command" required>
                  {f => (
                    <Input
                      {...f}
                      type="text"
                      value={formCommand}
                      onChange={e => setFormCommand(e.target.value)}
                      onBlur={autosave.flush}
                      placeholder="e.g. npx"
                    />
                  )}
                </FormField>

                <FormField label="Arguments (space-separated)">
                  {f => (
                    <Input
                      {...f}
                      type="text"
                      value={formArgs}
                      onChange={e => setFormArgs(e.target.value)}
                      onBlur={autosave.flush}
                      placeholder="e.g. -y @modelcontextprotocol/server-filesystem /path/to/dir"
                      className="font-mono"
                    />
                  )}
                </FormField>
              </>
            ) : (
              <FormField label="Remote MCP URL" required>
                {f => (
                  <Input
                    {...f}
                    type="text"
                    value={formUrl}
                    onChange={e => setFormUrl(e.target.value)}
                    onBlur={autosave.flush}
                    placeholder="https://mcp.example.com/mcp"
                    className="font-mono"
                  />
                )}
              </FormField>
            )}

            {/* Env vars / headers */}
            {formTransport === 'stdio' ? (
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground">
                    Environment Variables
                  </label>
                  <button
                    type="button"
                    onClick={() => setFormEnvPairs([...formEnvPairs, { key: '', value: '' }])}
                    className="text-xs text-primary transition-colors hover:text-primary/80"
                  >
                    + Add
                  </button>
                </div>
                {formEnvPairs.map((pair, i) => (
                  <div key={i} className="mb-1 flex gap-2">
                    <input
                      type="text"
                      value={pair.key}
                      onChange={e => {
                        const updated = [...formEnvPairs];
                        updated[i] = { ...pair, key: e.target.value };
                        setFormEnvPairs(updated);
                      }}
                      onBlur={autosave.flush}
                      placeholder="KEY"
                      className={`${FIELD_CLASS} flex-1 font-mono text-xs`}
                    />
                    <input
                      type="text"
                      value={pair.value}
                      onChange={e => {
                        const updated = [...formEnvPairs];
                        updated[i] = { ...pair, value: e.target.value };
                        setFormEnvPairs(updated);
                      }}
                      onBlur={autosave.flush}
                      placeholder="value"
                      className={`${FIELD_CLASS} flex-1 font-mono text-xs`}
                    />
                    <button
                      type="button"
                      onClick={() => setFormEnvPairs(formEnvPairs.filter((_, j) => j !== i))}
                      className="rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive"
                      aria-label="Remove environment variable"
                    >
                      <svg
                        className="h-3.5 w-3.5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
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
            ) : (
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground">HTTP Headers</label>
                  <button
                    type="button"
                    onClick={() => setFormHeaderPairs([...formHeaderPairs, { key: '', value: '' }])}
                    className="text-xs text-primary transition-colors hover:text-primary/80"
                  >
                    + Add
                  </button>
                </div>
                {formHeaderPairs.map((pair, i) => (
                  <div key={i} className="mb-1 flex gap-2">
                    <input
                      type="text"
                      value={pair.key}
                      onChange={e => {
                        const updated = [...formHeaderPairs];
                        updated[i] = { ...pair, key: e.target.value };
                        setFormHeaderPairs(updated);
                      }}
                      onBlur={autosave.flush}
                      placeholder="Header"
                      className={`${FIELD_CLASS} flex-1 font-mono text-xs`}
                    />
                    <input
                      type="text"
                      value={pair.value}
                      onChange={e => {
                        const updated = [...formHeaderPairs];
                        updated[i] = { ...pair, value: e.target.value };
                        setFormHeaderPairs(updated);
                      }}
                      onBlur={autosave.flush}
                      placeholder="value"
                      className={`${FIELD_CLASS} flex-1 font-mono text-xs`}
                    />
                    <button
                      type="button"
                      onClick={() => setFormHeaderPairs(formHeaderPairs.filter((_, j) => j !== i))}
                      className="rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive"
                      aria-label="Remove header"
                    >
                      <svg
                        className="h-3.5 w-3.5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
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

            {formTransport !== 'stdio' && (
              <div>
                <FieldLabel htmlFor="mcp-headers-helper">Headers Helper</FieldLabel>
                <input
                  id="mcp-headers-helper"
                  type="text"
                  value={formHeadersHelper}
                  onChange={e => setFormHeadersHelper(e.target.value)}
                  onBlur={autosave.flush}
                  placeholder="Command that prints JSON headers, e.g. node ./headers-helper.js"
                  className={`${FIELD_CLASS} font-mono`}
                />
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Runs before remote MCP connect. It must print a JSON object whose values are
                  strings.
                </p>
              </div>
            )}
          </EditorSection>

          {formTransport !== 'stdio' && (
            <EditorSection title="Authentication">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  aria-label="Enable OAuth"
                  checked={formOAuthEnabled}
                  onChange={e => setFormOAuthEnabled(e.target.checked)}
                  className="rounded border-border bg-secondary/50"
                />
                Enable OAuth
              </label>
              {formOAuthEnabled && (
                <div className="grid gap-2 md:grid-cols-2">
                  <div className="md:col-span-2">
                    <FormField label="Metadata URL">
                      {f => (
                        <Input
                          {...f}
                          type="text"
                          value={formOAuthMetadataUrl}
                          onChange={e => setFormOAuthMetadataUrl(e.target.value)}
                          onBlur={autosave.flush}
                          placeholder="https://auth.example.com/.well-known/oauth-authorization-server"
                          className="text-xs font-mono"
                        />
                      )}
                    </FormField>
                  </div>
                  <FormField label="Authorization Endpoint">
                    {f => (
                      <Input
                        {...f}
                        type="text"
                        value={formOAuthAuthorizationEndpoint}
                        onChange={e => setFormOAuthAuthorizationEndpoint(e.target.value)}
                        onBlur={autosave.flush}
                        placeholder="https://auth.example.com/oauth/authorize"
                        className="text-xs font-mono"
                      />
                    )}
                  </FormField>
                  <FormField label="Token Endpoint">
                    {f => (
                      <Input
                        {...f}
                        type="text"
                        value={formOAuthTokenEndpoint}
                        onChange={e => setFormOAuthTokenEndpoint(e.target.value)}
                        onBlur={autosave.flush}
                        placeholder="https://auth.example.com/oauth/token"
                        className="text-xs font-mono"
                      />
                    )}
                  </FormField>
                  <FormField label="Device Authorization Endpoint">
                    {f => (
                      <Input
                        {...f}
                        type="text"
                        value={formOAuthDeviceEndpoint}
                        onChange={e => setFormOAuthDeviceEndpoint(e.target.value)}
                        onBlur={autosave.flush}
                        placeholder="https://auth.example.com/oauth/device"
                        className="text-xs font-mono"
                      />
                    )}
                  </FormField>
                  <FormField label="Client ID">
                    {f => (
                      <Input
                        {...f}
                        type="text"
                        value={formOAuthClientId}
                        onChange={e => setFormOAuthClientId(e.target.value)}
                        onBlur={autosave.flush}
                        placeholder="zclaudia-client-id"
                        className="text-xs font-mono"
                      />
                    )}
                  </FormField>
                  <FormField label="Client Secret">
                    {f => (
                      <Input
                        {...f}
                        type="password"
                        value={formOAuthClientSecret}
                        onChange={e => setFormOAuthClientSecret(e.target.value)}
                        onBlur={autosave.flush}
                        placeholder="client secret (optional)"
                        className="text-xs font-mono"
                      />
                    )}
                  </FormField>
                  <FormField label="Scopes">
                    {f => (
                      <Input
                        {...f}
                        type="text"
                        value={formOAuthScopes}
                        onChange={e => setFormOAuthScopes(e.target.value)}
                        onBlur={autosave.flush}
                        placeholder="repo read:user"
                        className="text-xs font-mono"
                      />
                    )}
                  </FormField>
                </div>
              )}
            </EditorSection>
          )}

          <EditorSection
            title="Trust Policy"
            description="Controls how self-declared MCP read-only hints and risk levels affect permission prompts."
          >
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel htmlFor="mcp-trust-level">Trust Level</FieldLabel>
                <select
                  id="mcp-trust-level"
                  aria-label="Trust Level"
                  value={formTrustLevel}
                  onChange={e => setFormTrustLevel(e.target.value as McpServerTrustLevel)}
                  className={FIELD_CLASS}
                >
                  <option value="untrusted">Untrusted</option>
                  <option value="trusted-readonly">Trusted read-only</option>
                  <option value="trusted">Trusted</option>
                </select>
              </div>
              <div>
                <FieldLabel htmlFor="mcp-default-risk-action">Default risk action</FieldLabel>
                <select
                  id="mcp-default-risk-action"
                  aria-label="Default risk action"
                  value={formDefaultRiskAction}
                  onChange={e => setFormDefaultRiskAction(e.target.value as McpRiskAction)}
                  className={FIELD_CLASS}
                >
                  {RISK_ACTION_OPTIONS.filter(opt => opt.value).map(opt => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={formTrustReadOnlyHint}
                onChange={e => setFormTrustReadOnlyHint(e.target.checked)}
                className="rounded border-border bg-secondary/50"
              />
              Trust read-only hints
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['low', 'medium', 'high'] as const).map(level => (
                <div key={level}>
                  <FieldLabel htmlFor={`mcp-${level}-risk-action`}>
                    {`${level[0].toUpperCase()}${level.slice(1)}`} risk action
                  </FieldLabel>
                  <select
                    id={`mcp-${level}-risk-action`}
                    aria-label={`${level[0].toUpperCase()}${level.slice(1)} risk action`}
                    value={formRiskActions[level] ?? ''}
                    onChange={e => setRiskAction(level, e.target.value as McpRiskAction | '')}
                    className={`${FIELD_CLASS} text-xs`}
                  >
                    {RISK_ACTION_OPTIONS.map(opt => (
                      <option key={opt.value || 'default'} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </EditorSection>

          <EditorSection title="Provider Scope" description="Empty = all providers.">
            <div className="flex flex-wrap gap-2">
              {PROVIDER_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggleScope(opt.value)}
                  className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                    formScope.includes(opt.value)
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-background/70 text-muted-foreground hover:border-primary/50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </EditorSection>
        </div>
      </div>

      {oauthLogin && server && (
        <McpOAuthLoginModal
          backendId={backendId}
          serverName={server.name}
          session={oauthLogin.session}
          onClose={() => setOauthLogin(null)}
          onSuccess={handleOAuthSuccess}
        />
      )}
    </div>
  );
}
