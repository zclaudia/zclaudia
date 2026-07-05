/**
 * Backend-scoped MCP server editor
 *
 * Standalone create/edit form + connection actions for one MCP server on one
 * backend, extracted from the settings McpServerSettings monolith. Talks to
 * the ForBackend API variants directly — no global store.
 *
 * Parent must remount this component per identity — key it by
 * `${backendId}:${server?.id ?? 'new'}`. Form state initializes from the
 * `server` prop on mount only; prop-driven switching of backendId or server
 * without a key change is not supported.
 *
 * Deliberately not carried over from the settings component: readOnly mode,
 * the search bar, stats cards, list rows, the mcpServerStore, and the
 * expandable inventory browser (tools/resources/prompts details — deferred).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
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
  onSaved: (id: string) => void;
  onDeleted: () => void;
  /** Connection-state actions changed something (connect/disconnect/refresh/toggle/oauth) — parent refetches. */
  onStatusChanged: () => void;
}

const statusBadgeClass = (state?: string) => {
  if (state === 'connected') return 'bg-green-500/20 text-green-400';
  if (state === 'failed') return 'bg-red-500/20 text-red-400';
  if (state === 'needs-auth') return 'bg-orange-500/20 text-orange-300';
  if (state === 'connecting') return 'bg-yellow-500/20 text-yellow-400';
  if (state === 'disabled') return 'bg-gray-500/20 text-gray-500';
  return 'bg-blue-500/10 text-blue-400';
};

export function McpServerEditor({
  backendId,
  server,
  status,
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
  const [formError, setFormError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [oauthLogin, setOauthLogin] = useState<{ session: McpOAuthStartResult } | null>(null);

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

  const handleSubmit = useCallback(async () => {
    if (
      !formName.trim() ||
      (formTransport === 'stdio' && !formCommand.trim()) ||
      (formTransport !== 'stdio' && !formUrl.trim())
    ) {
      setFormError(
        formTransport === 'stdio' ? 'Name and command are required' : 'Name and URL are required'
      );
      return;
    }

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

    setSaving(true);
    setFormError(null);
    try {
      if (server) {
        const updated = await updateMcpServerForBackend(backendId, server.id, {
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
        onSaved(created.id);
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
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
    server,
    backendId,
    onSaved,
  ]);

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
      if (!server) return;
      setActionError(null);
      try {
        const session = await startMcpOAuthForBackend(backendId, server.name, method);
        if (session.method === 'browser') {
          window.open(session.authUrl, '_blank', 'noopener,noreferrer');
        }
        setOauthLogin({ session });
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
      }
    },
    [backendId, server]
  );

  const handleDelete = async () => {
    if (!server || deleting) return;

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

  const renderActionRow = (current: McpServerConfig) => (
    <div className="p-3 bg-secondary/50 rounded-lg border border-border/50 flex flex-wrap items-center gap-2">
      <span className="font-medium text-sm truncate">{current.name}</span>
      <span
        className={`px-1.5 py-0.5 rounded-md text-[10px] font-medium ${
          current.enabled ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-500'
        }`}
      >
        {current.enabled ? 'Enabled' : 'Disabled'}
      </span>
      <span
        className={`px-1.5 py-0.5 rounded-md text-[10px] font-medium ${statusBadgeClass(state)}`}
      >
        {state}
      </span>
      <div className="flex items-center gap-1 ml-auto">
        {current.enabled && (
          <>
            <button
              type="button"
              onClick={() =>
                void runAction(() => connectMcpServerForBackend(backendId, current.name))
              }
              className="px-2 py-1 text-[10px] rounded-md bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors"
              title="Connect"
            >
              Connect
            </button>
            <button
              type="button"
              onClick={() =>
                void runAction(() => disconnectMcpServerForBackend(backendId, current.name))
              }
              className="px-2 py-1 text-[10px] rounded-md bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors"
              title="Disconnect"
            >
              Disconnect
            </button>
            <button
              type="button"
              onClick={() =>
                void runAction(() => refreshMcpServerForBackend(backendId, current.name))
              }
              className="px-2 py-1 text-[10px] rounded-md bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors"
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
                  className="px-2 py-1 text-[10px] rounded-md bg-orange-500/20 text-orange-200 hover:bg-orange-500/30 transition-colors"
                  title="Start MCP OAuth login"
                >
                  OAuth Login
                </button>
                {current.oauthConfig.deviceAuthorizationEndpoint && (
                  <button
                    type="button"
                    onClick={() => void handleOAuthLogin('device_code')}
                    className="px-2 py-1 text-[10px] rounded-md bg-orange-500/10 text-orange-200 hover:bg-orange-500/20 transition-colors"
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
                    className="px-2 py-1 text-[10px] rounded-md bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors"
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
                  className="px-2 py-1 text-[10px] rounded-md bg-orange-500/20 text-orange-200 hover:bg-orange-500/30 transition-colors"
                  title="Refresh after updating MCP credentials"
                >
                  Authenticate
                </button>
              )
            )}
          </>
        )}
        <button
          type="button"
          onClick={() => void runAction(() => toggleMcpServerForBackend(backendId, current.id))}
          className={`relative w-10 h-5 rounded-full transition-colors ${
            current.enabled ? 'bg-primary' : 'bg-secondary'
          }`}
          title={current.enabled ? 'Disable' : 'Enable'}
        >
          <span
            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
              current.enabled ? 'left-5' : 'left-0.5'
            }`}
          />
        </button>
        <button
          type="button"
          onClick={() => void handleDelete()}
          disabled={deleting}
          className={`px-2 py-1 text-[10px] rounded-md transition-colors disabled:opacity-50 ${
            pendingDelete
              ? 'bg-destructive/15 text-destructive hover:bg-destructive/25'
              : 'bg-secondary text-destructive hover:bg-secondary/80'
          }`}
          title={pendingDelete ? 'Click again to confirm delete' : 'Delete'}
        >
          {deleting ? 'Deleting...' : pendingDelete ? 'Confirm delete' : 'Delete'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {server && renderActionRow(server)}

      {actionError && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p className="text-red-400 text-sm">{actionError}</p>
        </div>
      )}

      <div className="bg-secondary/50 border border-border/50 rounded-lg p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Name *</label>
            <input
              type="text"
              value={formName}
              onChange={e => setFormName(e.target.value)}
              placeholder="e.g. filesystem"
              className="w-full px-3 py-1.5 text-sm bg-secondary/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div>
            <label htmlFor="mcp-transport" className="block text-xs text-muted-foreground mb-1">
              Transport
            </label>
            <select
              id="mcp-transport"
              aria-label="Transport"
              value={formTransport}
              onChange={e => setFormTransport(e.target.value as McpServerTransport)}
              className="w-full px-3 py-1.5 text-sm bg-secondary/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="stdio">stdio</option>
              <option value="streamable-http">streamable-http</option>
              <option value="sse">sse</option>
            </select>
          </div>
        </div>

        {formTransport === 'stdio' ? (
          <>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Command *</label>
              <input
                type="text"
                value={formCommand}
                onChange={e => setFormCommand(e.target.value)}
                placeholder="e.g. npx"
                className="w-full px-3 py-1.5 text-sm bg-secondary/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div>
              <label className="block text-xs text-muted-foreground mb-1">
                Arguments (space-separated)
              </label>
              <input
                type="text"
                value={formArgs}
                onChange={e => setFormArgs(e.target.value)}
                placeholder="e.g. -y @modelcontextprotocol/server-filesystem /path/to/dir"
                className="w-full px-3 py-1.5 text-sm bg-secondary/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono"
              />
            </div>
          </>
        ) : (
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Remote MCP URL *</label>
            <input
              type="text"
              value={formUrl}
              onChange={e => setFormUrl(e.target.value)}
              placeholder="https://mcp.example.com/mcp"
              className="w-full px-3 py-1.5 text-sm bg-secondary/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono"
            />
          </div>
        )}

        <div>
          <label className="block text-xs text-muted-foreground mb-1">Description</label>
          <input
            type="text"
            value={formDescription}
            onChange={e => setFormDescription(e.target.value)}
            placeholder="Optional description"
            className="w-full px-3 py-1.5 text-sm bg-secondary/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        {/* Env vars / headers */}
        {formTransport === 'stdio' ? (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-muted-foreground">Environment Variables</label>
              <button
                type="button"
                onClick={() => setFormEnvPairs([...formEnvPairs, { key: '', value: '' }])}
                className="text-xs text-primary hover:text-primary/80 transition-colors"
              >
                + Add
              </button>
            </div>
            {formEnvPairs.map((pair, i) => (
              <div key={i} className="flex gap-2 mb-1">
                <input
                  type="text"
                  value={pair.key}
                  onChange={e => {
                    const updated = [...formEnvPairs];
                    updated[i] = { ...pair, key: e.target.value };
                    setFormEnvPairs(updated);
                  }}
                  placeholder="KEY"
                  className="flex-1 px-2 py-1 text-xs bg-secondary/50 border border-border rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <input
                  type="text"
                  value={pair.value}
                  onChange={e => {
                    const updated = [...formEnvPairs];
                    updated[i] = { ...pair, value: e.target.value };
                    setFormEnvPairs(updated);
                  }}
                  placeholder="value"
                  className="flex-1 px-2 py-1 text-xs bg-secondary/50 border border-border rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <button
                  type="button"
                  onClick={() => setFormEnvPairs(formEnvPairs.filter((_, j) => j !== i))}
                  className="p-0.5 rounded-md hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors"
                  aria-label="Remove environment variable"
                >
                  <svg
                    className="w-3.5 h-3.5"
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
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-muted-foreground">HTTP Headers</label>
              <button
                type="button"
                onClick={() => setFormHeaderPairs([...formHeaderPairs, { key: '', value: '' }])}
                className="text-xs text-primary hover:text-primary/80 transition-colors"
              >
                + Add
              </button>
            </div>
            {formHeaderPairs.map((pair, i) => (
              <div key={i} className="flex gap-2 mb-1">
                <input
                  type="text"
                  value={pair.key}
                  onChange={e => {
                    const updated = [...formHeaderPairs];
                    updated[i] = { ...pair, key: e.target.value };
                    setFormHeaderPairs(updated);
                  }}
                  placeholder="Header"
                  className="flex-1 px-2 py-1 text-xs bg-secondary/50 border border-border rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <input
                  type="text"
                  value={pair.value}
                  onChange={e => {
                    const updated = [...formHeaderPairs];
                    updated[i] = { ...pair, value: e.target.value };
                    setFormHeaderPairs(updated);
                  }}
                  placeholder="value"
                  className="flex-1 px-2 py-1 text-xs bg-secondary/50 border border-border rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <button
                  type="button"
                  onClick={() => setFormHeaderPairs(formHeaderPairs.filter((_, j) => j !== i))}
                  className="p-0.5 rounded-md hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors"
                  aria-label="Remove header"
                >
                  <svg
                    className="w-3.5 h-3.5"
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
            <label className="block text-xs text-muted-foreground mb-1">Headers Helper</label>
            <input
              type="text"
              value={formHeadersHelper}
              onChange={e => setFormHeadersHelper(e.target.value)}
              placeholder="Command that prints JSON headers, e.g. node ./headers-helper.js"
              className="w-full px-3 py-1.5 text-sm bg-secondary/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Runs before remote MCP connect. It must print a JSON object whose values are strings.
            </p>
          </div>
        )}

        {formTransport !== 'stdio' && (
          <div className="rounded-lg border border-border/50 bg-background/30 p-3 space-y-3">
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
                <input
                  type="text"
                  value={formOAuthMetadataUrl}
                  onChange={e => setFormOAuthMetadataUrl(e.target.value)}
                  placeholder="https://auth.example.com/.well-known/oauth-authorization-server"
                  className="px-3 py-1.5 text-xs bg-secondary/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono md:col-span-2"
                />
                <input
                  type="text"
                  value={formOAuthAuthorizationEndpoint}
                  onChange={e => setFormOAuthAuthorizationEndpoint(e.target.value)}
                  placeholder="https://auth.example.com/oauth/authorize"
                  className="px-3 py-1.5 text-xs bg-secondary/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono"
                />
                <input
                  type="text"
                  value={formOAuthTokenEndpoint}
                  onChange={e => setFormOAuthTokenEndpoint(e.target.value)}
                  placeholder="https://auth.example.com/oauth/token"
                  className="px-3 py-1.5 text-xs bg-secondary/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono"
                />
                <input
                  type="text"
                  value={formOAuthDeviceEndpoint}
                  onChange={e => setFormOAuthDeviceEndpoint(e.target.value)}
                  placeholder="https://auth.example.com/oauth/device"
                  className="px-3 py-1.5 text-xs bg-secondary/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono"
                />
                <input
                  type="text"
                  value={formOAuthClientId}
                  onChange={e => setFormOAuthClientId(e.target.value)}
                  placeholder="zclaudia-client-id"
                  className="px-3 py-1.5 text-xs bg-secondary/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono"
                />
                <input
                  type="password"
                  value={formOAuthClientSecret}
                  onChange={e => setFormOAuthClientSecret(e.target.value)}
                  placeholder="client secret (optional)"
                  className="px-3 py-1.5 text-xs bg-secondary/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono"
                />
                <input
                  type="text"
                  value={formOAuthScopes}
                  onChange={e => setFormOAuthScopes(e.target.value)}
                  placeholder="repo read:user"
                  className="px-3 py-1.5 text-xs bg-secondary/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono"
                />
              </div>
            )}
          </div>
        )}

        {/* Trust policy */}
        <div className="rounded-lg border border-border/50 bg-background/30 p-3 space-y-3">
          <div>
            <div className="text-xs font-medium text-foreground">Trust Policy</div>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Controls how self-declared MCP read-only hints and risk levels affect permission
              prompts.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="mcp-trust-level" className="block text-xs text-muted-foreground mb-1">
                Trust Level
              </label>
              <select
                id="mcp-trust-level"
                aria-label="Trust Level"
                value={formTrustLevel}
                onChange={e => setFormTrustLevel(e.target.value as McpServerTrustLevel)}
                className="w-full px-3 py-1.5 text-sm bg-secondary/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="untrusted">Untrusted</option>
                <option value="trusted-readonly">Trusted read-only</option>
                <option value="trusted">Trusted</option>
              </select>
            </div>
            <div>
              <label
                htmlFor="mcp-default-risk-action"
                className="block text-xs text-muted-foreground mb-1"
              >
                Default risk action
              </label>
              <select
                id="mcp-default-risk-action"
                aria-label="Default risk action"
                value={formDefaultRiskAction}
                onChange={e => setFormDefaultRiskAction(e.target.value as McpRiskAction)}
                className="w-full px-3 py-1.5 text-sm bg-secondary/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
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
                <label
                  htmlFor={`mcp-${level}-risk-action`}
                  className="block text-xs capitalize text-muted-foreground mb-1"
                >
                  {level} risk action
                </label>
                <select
                  id={`mcp-${level}-risk-action`}
                  aria-label={`${level[0].toUpperCase()}${level.slice(1)} risk action`}
                  value={formRiskActions[level] ?? ''}
                  onChange={e => setRiskAction(level, e.target.value as McpRiskAction | '')}
                  className="w-full px-2 py-1.5 text-xs bg-secondary/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
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
        </div>

        {/* Provider scope */}
        <div>
          <label className="block text-xs text-muted-foreground mb-1">
            Provider Scope (empty = all providers)
          </label>
          <div className="flex flex-wrap gap-2">
            {PROVIDER_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggleScope(opt.value)}
                className={`px-2 py-0.5 text-xs rounded-lg border transition-colors ${
                  formScope.includes(opt.value)
                    ? 'bg-muted border-primary text-primary'
                    : 'bg-secondary/50 border-border text-muted-foreground hover:border-primary/50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {formError && <p className="text-xs text-red-400">{formError}</p>}

        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={saving}
            className="px-3 py-1.5 text-sm bg-muted/60 text-foreground rounded-lg hover:bg-muted disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : server ? 'Save' : 'Add'}
          </button>
        </div>
      </div>

      {oauthLogin && server && (
        <McpOAuthLoginModal
          backendId={backendId}
          serverName={server.name}
          session={oauthLogin.session}
          onClose={() => setOauthLogin(null)}
          onSuccess={() => {
            setOauthLogin(null);
            void runAction(() => refreshMcpServerForBackend(backendId, server.name));
          }}
        />
      )}
    </div>
  );
}
