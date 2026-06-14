/**
 * MCP Server Settings Component
 *
 * Manages MCP server configurations: list, add, edit, delete, toggle.
 */

import { useState, useEffect, useCallback } from 'react';
import { useMcpServerStore } from '../../stores/mcpServerStore';
import { cancelMcpOAuth, pollMcpOAuthStatus, startMcpOAuth } from '../../services/api/mcp-servers';
import type { McpServerConfig } from '@zclaudia/shared';
import type { McpRiskAction, McpServerTransport, McpServerTrustLevel, McpServerTrustPolicy } from '@zclaudia/shared/core/mcp';

const PROVIDER_OPTIONS = [
  { value: 'zclaudia', label: 'ZClaudia' },
];

const RISK_ACTION_OPTIONS: Array<{ value: McpRiskAction | ''; label: string }> = [
  { value: '', label: 'Use default' },
  { value: 'auto-approve', label: 'Auto approve' },
  { value: 'ask', label: 'Ask' },
  { value: 'deny', label: 'Deny' },
];

function McpOAuthLoginModal({
  serverName,
  method,
  onClose,
  onSuccess,
}: {
  serverName: string;
  method: 'browser' | 'device_code';
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [session, setSession] = useState<Awaited<ReturnType<typeof startMcpOAuth>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await startMcpOAuth(serverName, method);
        if (cancelled) return;
        setSession(result);
        if (result.method === 'browser') {
          window.open(result.authUrl, '_blank', 'noopener,noreferrer');
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serverName, method]);

  useEffect(() => {
    if (!session) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const status = await pollMcpOAuthStatus(serverName, session.sessionId);
        if (stopped) return;
        if (status.state === 'success') {
          onSuccess();
          return;
        }
        if (status.state === 'error') {
          setError(status.message);
          return;
        }
        if (status.state === 'cancelled') {
          setError('OAuth login cancelled');
          return;
        }
        timer = setTimeout(poll, 2000);
      } catch (err) {
        if (!stopped) setError(err instanceof Error ? err.message : String(err));
      }
    };
    timer = setTimeout(poll, 1000);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [serverName, session, onSuccess]);

  const handleClose = async () => {
    if (session) {
      try {
        await cancelMcpOAuth(serverName, session.sessionId);
      } catch {
        // ignore cancellation errors
      }
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur">
      <div className="w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-lg">
        <h2 className="text-lg font-medium text-foreground">MCP OAuth Login</h2>
        <p className="mt-1 text-sm text-muted-foreground">Authenticate {serverName} and return here when the browser flow is complete.</p>
        {!session && !error && <p className="mt-3 text-sm text-muted-foreground">Starting OAuth flow...</p>}
        {session?.method === 'browser' && (
          <div className="mt-3 text-sm">
            <p>Waiting for browser authorization callback...</p>
            <code className="mt-2 block break-all rounded bg-secondary p-2 text-xs">{session.authUrl}</code>
          </div>
        )}
        {session?.method === 'device_code' && (
          <div className="mt-3 text-sm">
            <a href={session.verificationUri} target="_blank" rel="noreferrer" className="text-primary underline">
              Open verification page
            </a>
            <div className="mt-2 rounded bg-secondary p-3 text-center font-mono text-2xl tracking-widest">
              {session.userCode}
            </div>
          </div>
        )}
        {error && <div className="mt-3 rounded border border-red-500/30 bg-red-500/10 p-2 text-sm text-red-300">{error}</div>}
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={handleClose} className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-secondary">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function McpServerSettings({ readOnly = false }: { readOnly?: boolean }) {
  const {
    servers,
    statuses,
    isLoading,
    error,
    fetchServers,
    fetchStatuses,
    addServer,
    editServer,
    removeServer,
    toggle,
    connect,
    disconnect,
    refresh,
  } = useMcpServerStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [expandedInventoryServerId, setExpandedInventoryServerId] = useState<string | null>(null);
  const [inventorySearchQuery, setInventorySearchQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [oauthLogin, setOauthLogin] = useState<{ serverName: string; method: 'browser' | 'device_code' } | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formTransport, setFormTransport] = useState<McpServerTransport>('stdio');
  const [formCommand, setFormCommand] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formArgs, setFormArgs] = useState('');
  const [formEnvPairs, setFormEnvPairs] = useState<{ key: string; value: string }[]>([]);
  const [formHeaderPairs, setFormHeaderPairs] = useState<{ key: string; value: string }[]>([]);
  const [formHeadersHelper, setFormHeadersHelper] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formOAuthEnabled, setFormOAuthEnabled] = useState(false);
  const [formOAuthMetadataUrl, setFormOAuthMetadataUrl] = useState('');
  const [formOAuthAuthorizationEndpoint, setFormOAuthAuthorizationEndpoint] = useState('');
  const [formOAuthTokenEndpoint, setFormOAuthTokenEndpoint] = useState('');
  const [formOAuthDeviceEndpoint, setFormOAuthDeviceEndpoint] = useState('');
  const [formOAuthClientId, setFormOAuthClientId] = useState('');
  const [formOAuthClientSecret, setFormOAuthClientSecret] = useState('');
  const [formOAuthScopes, setFormOAuthScopes] = useState('');
  const [formScope, setFormScope] = useState<string[]>([]);
  const [formTrustLevel, setFormTrustLevel] = useState<McpServerTrustLevel>('untrusted');
  const [formTrustReadOnlyHint, setFormTrustReadOnlyHint] = useState(false);
  const [formDefaultRiskAction, setFormDefaultRiskAction] = useState<McpRiskAction>('ask');
  const [formRiskActions, setFormRiskActions] = useState<Partial<Record<'low' | 'medium' | 'high', McpRiskAction>>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    fetchServers();
    fetchStatuses();
  }, [fetchServers, fetchStatuses]);

  const resetForm = useCallback(() => {
    setFormName('');
    setFormTransport('stdio');
    setFormCommand('');
    setFormUrl('');
    setFormArgs('');
    setFormEnvPairs([]);
    setFormHeaderPairs([]);
    setFormHeadersHelper('');
    setFormDescription('');
    setFormOAuthEnabled(false);
    setFormOAuthMetadataUrl('');
    setFormOAuthAuthorizationEndpoint('');
    setFormOAuthTokenEndpoint('');
    setFormOAuthDeviceEndpoint('');
    setFormOAuthClientId('');
    setFormOAuthClientSecret('');
    setFormOAuthScopes('');
    setFormScope([]);
    setFormTrustLevel('untrusted');
    setFormTrustReadOnlyHint(false);
    setFormDefaultRiskAction('ask');
    setFormRiskActions({});
    setFormError(null);
  }, []);

  const openEditForm = useCallback((server: McpServerConfig) => {
    setEditingId(server.id);
    setShowAddForm(false);
    setFormName(server.name);
    setFormTransport(server.transport ?? 'stdio');
    setFormCommand(server.command);
    setFormUrl(server.url || '');
    setFormArgs(server.args?.join(' ') || '');
    setFormEnvPairs(
      server.env
        ? Object.entries(server.env).map(([key, value]) => ({ key, value }))
        : []
    );
    setFormHeaderPairs(
      server.headers
        ? Object.entries(server.headers).map(([key, value]) => ({ key, value }))
        : []
    );
    setFormHeadersHelper(server.headersHelper || '');
    setFormDescription(server.description || '');
    setFormOAuthEnabled(server.oauthConfig?.enabled ?? false);
    setFormOAuthMetadataUrl(server.oauthConfig?.metadataUrl ?? '');
    setFormOAuthAuthorizationEndpoint(server.oauthConfig?.authorizationEndpoint ?? '');
    setFormOAuthTokenEndpoint(server.oauthConfig?.tokenEndpoint ?? '');
    setFormOAuthDeviceEndpoint(server.oauthConfig?.deviceAuthorizationEndpoint ?? '');
    setFormOAuthClientId(server.oauthConfig?.clientId ?? '');
    setFormOAuthClientSecret(server.oauthConfig?.clientSecret ?? '');
    setFormOAuthScopes(server.oauthConfig?.scopes?.join(' ') ?? '');
    setFormScope(server.providerScope || []);
    setFormTrustLevel(server.trustPolicy?.trustLevel ?? 'untrusted');
    setFormTrustReadOnlyHint(server.trustPolicy?.trustReadOnlyHint ?? false);
    setFormDefaultRiskAction(server.trustPolicy?.defaultRiskAction ?? 'ask');
    setFormRiskActions(server.trustPolicy?.riskActions ?? {});
    setFormError(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!formName.trim() || (formTransport === 'stdio' && !formCommand.trim()) || (formTransport !== 'stdio' && !formUrl.trim())) {
      setFormError(formTransport === 'stdio' ? 'Name and command are required' : 'Name and URL are required');
      return;
    }

    const args = formArgs.trim() ? formArgs.trim().split(/\s+/) : undefined;
    const env = formEnvPairs.filter(p => p.key.trim()).length > 0
      ? Object.fromEntries(formEnvPairs.filter(p => p.key.trim()).map(p => [p.key, p.value]))
      : undefined;
    const headers = formHeaderPairs.filter(p => p.key.trim()).length > 0
      ? Object.fromEntries(formHeaderPairs.filter(p => p.key.trim()).map(p => [p.key, p.value]))
      : undefined;
    const headersHelper = formTransport !== 'stdio' && formHeadersHelper.trim()
      ? formHeadersHelper.trim()
      : undefined;
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
        Object.entries(formRiskActions).filter((entry): entry is ['low' | 'medium' | 'high', McpRiskAction] => !!entry[1])
      ),
    };

    try {
      if (editingId) {
        await editServer(editingId, {
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
        setEditingId(null);
      } else {
        await addServer({
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
        setShowAddForm(false);
      }
      resetForm();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  }, [formName, formTransport, formCommand, formUrl, formArgs, formEnvPairs, formHeaderPairs, formHeadersHelper, formDescription, formOAuthEnabled, formOAuthMetadataUrl, formOAuthAuthorizationEndpoint, formOAuthTokenEndpoint, formOAuthDeviceEndpoint, formOAuthClientId, formOAuthClientSecret, formOAuthScopes, formScope, formTrustLevel, formTrustReadOnlyHint, formDefaultRiskAction, formRiskActions, editingId, addServer, editServer, resetForm]);

  const handleDelete = useCallback(async (id: string, name: string) => {
    if (!confirm(`Delete MCP server "${name}"?`)) return;
    try {
      await removeServer(id);
    } catch (err) {
      console.error('Failed to delete MCP server:', err);
    }
  }, [removeServer]);

  const toggleScope = useCallback((provider: string) => {
    setFormScope(prev =>
      prev.includes(provider) ? prev.filter(p => p !== provider) : [...prev, provider]
    );
  }, []);

  const setRiskAction = useCallback((level: 'low' | 'medium' | 'high', action: McpRiskAction | '') => {
    setFormRiskActions(prev => {
      const next = { ...prev };
      if (action) next[level] = action;
      else delete next[level];
      return next;
    });
  }, []);

  // Filter
  const filtered = servers.filter(s =>
    !searchQuery || s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.command.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const enabledCount = servers.filter(s => s.enabled).length;
  const disabledCount = servers.length - enabledCount;

  const statusBadgeClass = (state?: string) => {
    if (state === 'connected') return 'bg-green-500/20 text-green-400';
    if (state === 'failed') return 'bg-red-500/20 text-red-400';
    if (state === 'needs-auth') return 'bg-orange-500/20 text-orange-300';
    if (state === 'connecting') return 'bg-yellow-500/20 text-yellow-400';
    if (state === 'disabled') return 'bg-gray-500/20 text-gray-500';
    return 'bg-blue-500/10 text-blue-400';
  };

  const oauthStatusFor = (server: McpServerConfig): { label: string; className: string } | null => {
    if (!server.oauthConfig?.enabled) return null;
    const credentials = server.oauthCredentials;
    if (!credentials?.hasAccessToken && !credentials?.accessToken) {
      return { label: 'not authenticated', className: 'text-orange-300' };
    }
    if (typeof credentials.expiresAt === 'number') {
      const remaining = credentials.expiresAt - Date.now();
      if (remaining <= 0) return { label: 'expired', className: 'text-red-300' };
      if (remaining <= 5 * 60 * 1000) return { label: 'expiring soon', className: 'text-yellow-300' };
    }
    return { label: 'authenticated', className: 'text-green-300' };
  };

  const matchesInventorySearch = (...values: Array<unknown>) => {
    const query = inventorySearchQuery.trim().toLowerCase();
    if (!query) return true;
    return values.some((value) => String(value ?? '').toLowerCase().includes(query));
  };

  const renderInventoryDetails = (server: McpServerConfig) => {
    const status = statuses[server.name];
    const detail = status?.inventoryDetail;
    const tools = (detail?.tools ?? []).filter((tool) =>
      matchesInventorySearch(tool.name, tool.description, tool.permissionSummary?.riskLevel)
    );
    const resources = (detail?.resources ?? []).filter((resource) =>
      matchesInventorySearch(resource.uri, resource.name, resource.description, resource.mimeType)
    );
    const prompts = (detail?.prompts ?? []).filter((prompt) =>
      matchesInventorySearch(prompt.name, prompt.description, prompt.arguments?.map((arg) => arg.name).join(' '))
    );

    return (
      <div className="mt-2 rounded-lg border border-border/50 bg-background/60 p-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground">
            Inventory cached at {status?.inventory?.cachedAt ? new Date(status.inventory.cachedAt).toLocaleString() : 'unknown'}
          </div>
          <input
            type="text"
            value={inventorySearchQuery}
            onChange={(event) => setInventorySearchQuery(event.target.value)}
            placeholder="Search inventory..."
            className="w-full sm:w-56 px-2 py-1 text-xs bg-secondary/50 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        {status?.lastError && (
          <div className="rounded-md border border-red-500/20 bg-red-500/10 px-2 py-1 text-xs text-red-300">
            {status.lastError}
          </div>
        )}

        <div className="space-y-2">
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Tools</div>
            {tools.length === 0 ? (
              <p className="rounded-md bg-secondary/30 px-2 py-1 text-xs text-muted-foreground">No tools match.</p>
            ) : tools.map((tool) => (
              <details key={tool.name} className="rounded-md bg-secondary/30 px-2 py-2">
                <summary className="cursor-pointer list-none">
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-xs text-foreground" title={tool.name}>{tool.name}</div>
                      {tool.description && (
                        <div className="mt-0.5 truncate text-[10px] text-muted-foreground" title={tool.description}>
                          {tool.description}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1 text-[10px]">
                      <span className="rounded-full bg-yellow-500/10 px-2 py-0.5 text-yellow-300">
                        Risk: {tool.permissionSummary?.riskLevel ?? 'unknown'}
                      </span>
                      <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-blue-300">
                        Readonly: {tool.permissionSummary?.declaredReadOnly ? 'declared' : 'not declared'}, {tool.permissionSummary?.trustedReadOnly ? 'trusted' : 'untrusted'}
                      </span>
                    </div>
                  </div>
                </summary>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <pre className="max-h-40 overflow-auto rounded-md bg-background/80 p-2 text-[10px] text-muted-foreground">
                    {JSON.stringify(tool.inputSchema ?? {}, null, 2)}
                  </pre>
                  <pre className="max-h-40 overflow-auto rounded-md bg-background/80 p-2 text-[10px] text-muted-foreground">
                    {JSON.stringify(tool.annotations ?? {}, null, 2)}
                  </pre>
                </div>
              </details>
            ))}
          </div>

          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Resources</div>
            {resources.length === 0 ? (
              <p className="rounded-md bg-secondary/30 px-2 py-1 text-xs text-muted-foreground">No resources match.</p>
            ) : resources.map((resource) => (
              <div key={resource.uri} className="rounded-md bg-secondary/30 px-2 py-2">
                <div className="break-all font-mono text-xs text-foreground">{resource.uri}</div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  {[resource.name, resource.mimeType].filter(Boolean).join(' | ') || 'resource'}
                </div>
              </div>
            ))}
          </div>

          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Prompts</div>
            {prompts.length === 0 ? (
              <p className="rounded-md bg-secondary/30 px-2 py-1 text-xs text-muted-foreground">No prompts match.</p>
            ) : prompts.map((prompt) => (
              <div key={prompt.name} className="rounded-md bg-secondary/30 px-2 py-2">
                <div className="font-mono text-xs text-foreground">{prompt.name}</div>
                {prompt.description && (
                  <div className="mt-0.5 text-[10px] text-muted-foreground">{prompt.description}</div>
                )}
                {prompt.arguments && prompt.arguments.length > 0 && (
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    args: {prompt.arguments.map((arg) => `${arg.name}${arg.required ? '*' : ''}`).join(', ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  if (isLoading && servers.length === 0) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
        <span className="ml-2 text-muted-foreground">Loading MCP servers...</span>
      </div>
    );
  }

  const renderForm = () => (
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
          <label htmlFor="mcp-transport" className="block text-xs text-muted-foreground mb-1">Transport</label>
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
            <label className="block text-xs text-muted-foreground mb-1">Arguments (space-separated)</label>
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
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
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
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
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
            Controls how self-declared MCP read-only hints and risk levels affect permission prompts.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="mcp-trust-level" className="block text-xs text-muted-foreground mb-1">Trust Level</label>
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
            <label htmlFor="mcp-default-risk-action" className="block text-xs text-muted-foreground mb-1">Default risk action</label>
            <select
              id="mcp-default-risk-action"
              aria-label="Default risk action"
              value={formDefaultRiskAction}
              onChange={e => setFormDefaultRiskAction(e.target.value as McpRiskAction)}
              className="w-full px-3 py-1.5 text-sm bg-secondary/50 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              {RISK_ACTION_OPTIONS.filter(opt => opt.value).map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
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
              <label htmlFor={`mcp-${level}-risk-action`} className="block text-xs capitalize text-muted-foreground mb-1">
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
                  <option key={opt.value || 'default'} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>

      {/* Provider scope */}
      <div>
        <label className="block text-xs text-muted-foreground mb-1">Provider Scope (empty = all providers)</label>
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

      {formError && (
        <p className="text-xs text-red-400">{formError}</p>
      )}

      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={() => { setShowAddForm(false); setEditingId(null); resetForm(); }}
          className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          className="px-3 py-1.5 text-sm bg-muted/60 text-foreground rounded-lg hover:bg-muted transition-colors"
        >
          {editingId ? 'Save' : 'Add'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Search + actions */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search MCP servers..."
            className="w-full pl-10 pr-4 py-2 bg-secondary/50 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        {!readOnly && (
        <button
          type="button"
          onClick={() => { setShowAddForm(true); setEditingId(null); resetForm(); }}
          className="px-3 py-2 text-sm bg-muted/60 text-foreground rounded-lg hover:bg-muted whitespace-nowrap transition-colors"
        >
          + Add
        </button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="p-3 bg-secondary/30 rounded-lg">
          <div className="text-2xl font-bold text-foreground">{servers.length}</div>
          <div className="text-xs text-muted-foreground">Total</div>
        </div>
        <div className="p-3 bg-secondary/30 rounded-lg">
          <div className="text-2xl font-bold text-green-400">{enabledCount}</div>
          <div className="text-xs text-muted-foreground">Enabled</div>
        </div>
        <div className="p-3 bg-secondary/30 rounded-lg">
          <div className="text-2xl font-bold text-muted-foreground">{disabledCount}</div>
          <div className="text-xs text-muted-foreground">Disabled</div>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Add form */}
      {!readOnly && showAddForm && !editingId && renderForm()}

      {/* Server list */}
      {filtered.length === 0 ? (
        <div className="text-center py-8">
          <svg
            className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"
            />
          </svg>
          <p className="text-muted-foreground text-sm">
            {servers.length === 0
              ? 'No MCP servers configured'
              : 'No servers match your search'}
          </p>
          {servers.length === 0 && (
            <p className="text-muted-foreground/70 text-xs mt-1">
              Add a server to get started
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(server => (
            <div key={server.id}>
              {!readOnly && editingId === server.id ? (
                renderForm()
              ) : (
                <>
                {(() => {
                  const oauthStatus = oauthStatusFor(server);
                  return (
                <div className="p-3 bg-secondary/50 rounded-lg border border-border/50 hover:border-border transition-colors flex items-start gap-3">
                  {(() => {
                    const status = statuses[server.name];
                    const state = status?.state ?? (server.enabled ? 'configured' : 'disabled');
                    return (
                      <>
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{server.name}</span>
                      <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-medium ${
                        server.enabled
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-gray-500/20 text-gray-500'
                      }`}>
                        {server.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-medium ${statusBadgeClass(state)}`}>
                        {state}
                      </span>
                      {(server.transport === 'streamable-http' || server.transport === 'sse') && (
                        <span className="px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-purple-500/10 text-purple-300">
                          {server.transport}
                        </span>
                      )}
                      {server.source === 'imported' && (
                        <span className="px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-blue-500/10 text-blue-400">
                          Imported
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground font-mono truncate mt-0.5" title={server.transport === 'streamable-http' || server.transport === 'sse' ? server.url : undefined}>
                      {server.transport === 'streamable-http' || server.transport === 'sse'
                        ? `${server.transport} ${server.url ?? ''}`
                        : `${server.command}${server.args?.length ? ` ${server.args.join(' ')}` : ''}`}
                    </p>
                    {(server.transport === 'streamable-http' || server.transport === 'sse') && server.url && (
                      <p className="text-[10px] text-muted-foreground/80 font-mono truncate mt-0.5" title={server.url}>
                        {server.url}
                      </p>
                    )}
                    {(server.transport === 'streamable-http' || server.transport === 'sse') && server.headersHelper && (
                      <p className="text-[10px] text-muted-foreground/80 font-mono truncate mt-0.5" title={server.headersHelper}>
                        Headers helper: {server.headersHelper}
                      </p>
                    )}
                    {oauthStatus && (
                      <div className="mt-1 flex flex-wrap gap-2 text-[10px]">
                        <span className={oauthStatus.className}>OAuth: {oauthStatus.label}</span>
                        {server.oauthCredentials?.scope && (
                          <span className="text-muted-foreground">Scopes: {server.oauthCredentials.scope}</span>
                        )}
                        {server.oauthCredentials?.expiresAt && (
                          <span className="text-muted-foreground">
                            Expires: {new Date(server.oauthCredentials.expiresAt).toLocaleString()}
                          </span>
                        )}
                      </div>
                    )}
                    {server.description && (
                      <p className="text-xs text-muted-foreground/70 mt-0.5">{server.description}</p>
                    )}
                    {server.providerScope && server.providerScope.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {server.providerScope.map(p => (
                          <span key={p} className="px-1.5 py-0.5 rounded-md text-[10px] bg-muted/60 text-primary font-mono">
                            {p}
                          </span>
                        ))}
                      </div>
                    )}
                    {(state === 'needs-auth' || status?.authRequired) && (
                      <div className="mt-2 rounded-md border border-orange-500/20 bg-orange-500/10 px-2 py-1.5 text-xs text-orange-200">
                        <div className="truncate" title={status?.authMessage || status?.lastError || undefined}>
                          {status?.authMessage || status?.lastError || 'This MCP server requires authentication.'}
                        </div>
                        <div className="mt-0.5 text-[10px] text-orange-200/80">
                          Update credentials, then authenticate to refresh this MCP server.
                        </div>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2 mt-2 text-[10px] text-muted-foreground">
                      <span>Tools: {status?.inventory?.tools ?? 'unknown'}</span>
                      <span>Resources: {status?.inventory?.resources ?? 'unknown'}</span>
                      <span>Prompts: {status?.inventory?.prompts ?? 'unknown'}</span>
                      {status?.lastError && (
                        <span className="text-red-400 truncate max-w-[260px]" title={status.lastError}>
                          Error: {status.lastError}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setExpandedInventoryServerId((current) => current === server.id ? null : server.id);
                        setInventorySearchQuery('');
                      }}
                      className="mt-2 text-[10px] text-primary hover:text-primary/80 transition-colors"
                    >
                      Inventory details
                    </button>
                  </div>

                  {/* Actions */}
                  {!readOnly && (
                  <div className="flex items-center gap-1 shrink-0">
                    {server.enabled && (
                      <>
                        <button
                          type="button"
                          onClick={() => connect(server.name)}
                          className="px-2 py-1 text-[10px] rounded-md bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors"
                          title="Connect"
                        >
                          Connect
                        </button>
                        <button
                          type="button"
                          onClick={() => disconnect(server.name)}
                          className="px-2 py-1 text-[10px] rounded-md bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors"
                          title="Disconnect"
                        >
                          Disconnect
                        </button>
                        <button
                          type="button"
                          onClick={() => refresh(server.name)}
                          className="px-2 py-1 text-[10px] rounded-md bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors"
                          title="Refresh inventory"
                        >
                          Refresh
                        </button>
                        {(server.transport === 'streamable-http' || server.transport === 'sse') && server.oauthConfig?.enabled ? (
                          <>
                            <button
                              type="button"
                              onClick={() => setOauthLogin({ serverName: server.name, method: 'browser' })}
                              className="px-2 py-1 text-[10px] rounded-md bg-orange-500/20 text-orange-200 hover:bg-orange-500/30 transition-colors"
                              title="Start MCP OAuth login"
                            >
                              OAuth Login
                            </button>
                          {server.oauthConfig.deviceAuthorizationEndpoint && (
                            <button
                              type="button"
                              onClick={() => setOauthLogin({ serverName: server.name, method: 'device_code' })}
                              className="px-2 py-1 text-[10px] rounded-md bg-orange-500/10 text-orange-200 hover:bg-orange-500/20 transition-colors"
                              title="Start MCP OAuth device-code login"
                            >
                              Device Login
                            </button>
                          )}
                          </>
                        ) : (state === 'needs-auth' || status?.authRequired) && (
                          <button
                            type="button"
                            onClick={() => refresh(server.name)}
                            className="px-2 py-1 text-[10px] rounded-md bg-orange-500/20 text-orange-200 hover:bg-orange-500/30 transition-colors"
                            title="Refresh after updating MCP credentials"
                          >
                            Authenticate
                          </button>
                        )}
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => toggle(server.id)}
                      className={`relative w-10 h-5 rounded-full transition-colors ${
                        server.enabled ? 'bg-primary' : 'bg-secondary'
                      }`}
                      title={server.enabled ? 'Disable' : 'Enable'}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                        server.enabled ? 'left-5' : 'left-0.5'
                      }`} />
                    </button>
                    <button
                      type="button"
                      onClick={() => openEditForm(server)}
                      className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                      title="Edit"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(server.id, server.name)}
                      className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-red-400 transition-colors"
                      title="Delete"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                  )}
                      </>
                    );
                  })()}
                </div>
                  );
                })()}
                {expandedInventoryServerId === server.id && renderInventoryDetails(server)}
                </>
              )}
            </div>
          ))}
        </div>
      )}
      {oauthLogin && (
        <McpOAuthLoginModal
          serverName={oauthLogin.serverName}
          method={oauthLogin.method}
          onClose={() => setOauthLogin(null)}
          onSuccess={() => {
            const serverName = oauthLogin.serverName;
            setOauthLogin(null);
            void refresh(serverName);
            void fetchStatuses();
          }}
        />
      )}
    </div>
  );
}
