import type { McpServerConfig, McpServerStatus } from '@zclaudia/shared/core/mcp';
import type { ProfileConfigDescriptor } from '@zclaudia/shared/core/profile-config-descriptor';
import type { ToolSelection } from '@zclaudia/shared/core/tools';
import { CapabilityNote } from './CapabilityNote';
import {
  externalProviderLabel,
  externalToolRefLabel,
  formatPinnedExternalToolCount,
  mcpTrustSummaryLabels,
} from './derive';

/**
 * "Providers" sub-panel of the profile editor's Capabilities tab: the backend's
 * configured MCP servers with add/remove toggles plus any plugin providers and
 * pinned external tools, or a read-only note when the runtime sources
 * providers externally.
 *
 * Purely presentational — selection state lives in the parent's
 * `useToolSetSelection` hook; server/status catalogs come from the parent's
 * backend load.
 */
export function McpProvidersPanel({
  descriptor,
  formToolSelection,
  mcpServers,
  mcpStatuses,
  mcpProviderSelected,
  toggleMcpProvider,
}: {
  descriptor: ProfileConfigDescriptor;
  formToolSelection: ToolSelection;
  mcpServers: McpServerConfig[];
  mcpStatuses: Record<string, McpServerStatus>;
  mcpProviderSelected: (serverName: string) => boolean;
  toggleMcpProvider: (serverName: string) => void;
}) {
  if (descriptor.capabilities.providers !== 'profile') {
    return (
      <CapabilityNote
        title="Managed by ~/.claude"
        body="MCP providers for the Claude runtime come from your ~/.claude configuration and aren't set per profile here."
      />
    );
  }

  const externalProviders = formToolSelection.providers ?? [];
  const pinnedExternalToolLabels = formToolSelection.include.flatMap(ref => {
    const label = externalToolRefLabel(ref);
    return label ? [label] : [];
  });

  return (
    <div className="rounded-lg text-sm max-md:border-0 max-md:bg-transparent max-md:p-0 md:border md:border-border md:bg-secondary/50 md:p-3">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">Configured MCP servers</p>
          <span className="text-[10px] text-muted-foreground">
            {externalProviders.filter(provider => provider.source === 'mcp').length} selected
          </span>
        </div>
        {mcpServers.length === 0 ? (
          <p className="rounded-md bg-background/60 px-2 py-2 text-xs text-muted-foreground">
            No MCP servers configured.
          </p>
        ) : (
          mcpServers.map(server => {
            const status = mcpStatuses[server.name];
            const selected = mcpProviderSelected(server.name);
            const state = status?.state ?? (server.enabled ? 'configured' : 'disabled');
            return (
              <div
                key={server.id}
                className="flex min-w-0 flex-col gap-2 rounded-md bg-background/60 px-2 py-2 md:flex-row md:items-center md:justify-between md:gap-3"
              >
                <div className="min-w-0 flex-1">
                  {/* Wraps below md: the state pill is shrink-0, so
                      on one line the name was the only thing that
                      could give way. */}
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 md:flex-nowrap">
                    <span
                      className="min-w-0 max-w-full truncate font-mono text-xs"
                      title={`mcp/${server.name}`}
                    >
                      mcp/{server.name}
                    </span>
                    <span
                      className={`shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] ${
                        state === 'connected'
                          ? 'text-success'
                          : state === 'failed'
                            ? 'text-destructive'
                            : state === 'needs-auth'
                              ? 'text-warning'
                              : 'text-muted-foreground'
                      }`}
                    >
                      {state}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-[10px] text-muted-foreground">
                    tools {status?.inventory?.tools ?? 'unknown'} | resources{' '}
                    {status?.inventory?.resources ?? 'unknown'} | prompts{' '}
                    {status?.inventory?.prompts ?? 'unknown'}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {mcpTrustSummaryLabels(server).map(label => (
                      <span
                        key={label}
                        className="rounded-full bg-secondary/80 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => toggleMcpProvider(server.name)}
                  className={`shrink-0 rounded-md px-2 py-1 text-[10px] transition-colors max-md:w-full max-md:py-2 max-md:text-xs ${
                    selected
                      ? 'bg-muted text-primary hover:bg-muted'
                      : 'bg-secondary text-muted-foreground hover:text-foreground'
                  } disabled:opacity-50`}
                >
                  {selected ? 'Remove' : 'Add'}
                </button>
              </div>
            );
          })
        )}
        {externalProviders.some(provider => provider.source === 'plugin') && (
          <div className="border-t border-border/70 pt-2">
            <p className="mb-1 text-xs text-muted-foreground">Plugin providers</p>
            {externalProviders
              .filter(provider => provider.source === 'plugin')
              .map(provider => {
                const label = externalProviderLabel(provider);
                return (
                  <div key={label} className="rounded-md bg-background/60 px-2 py-2">
                    <span className="font-mono text-xs" title={label}>
                      {label}
                    </span>
                    <span className="ml-2 text-[10px] text-muted-foreground">
                      not yet connected
                    </span>
                  </div>
                );
              })}
          </div>
        )}
      </div>
      <div className="mt-2 border-t border-border/70 pt-2">
        <p className="text-[10px] text-muted-foreground">
          {formatPinnedExternalToolCount(pinnedExternalToolLabels.length)}
        </p>
        {pinnedExternalToolLabels.length > 0 && (
          <p
            className="mt-1 truncate font-mono text-[10px] text-muted-foreground"
            title={pinnedExternalToolLabels.join(', ')}
          >
            {pinnedExternalToolLabels.join(', ')}
          </p>
        )}
      </div>
    </div>
  );
}
