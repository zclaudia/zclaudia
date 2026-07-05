import type { McpServerConfig, McpServerStatus } from '@zclaudia/shared';
import { BackendGroup } from './BackendGroup';
import { TreeInfoRow, treeRowClass } from './treeRows';
import type { AgentsBackend, AgentsSelection } from './agents-types';
import type { McpServersByBackend } from './useMcpServersByBackend';

interface McpServersTreeProps {
  backends: AgentsBackend[];
  data: McpServersByBackend;
  selection: AgentsSelection | null;
  expandedBackendIds: string[];
  onToggleBackend: (backendId: string) => void;
  onSelectItem: (sel: AgentsSelection) => void;
}

/**
 * Status dot color for a server row. Mirrors McpServerSettings' badge semantics with
 * tree-dot vocabulary: connected → success, connecting → pulsing success, failed →
 * destructive, needs-auth → warning; everything inert (config disabled, runtime
 * disabled, configured-but-not-connected, idle, or no status reported) → muted.
 */
function statusDotClass(server: McpServerConfig, status: McpServerStatus | undefined): string {
  if (server.enabled === false) return 'bg-muted-foreground/40';
  switch (status?.state) {
    case 'connected':
      return 'bg-success';
    case 'connecting':
      return 'bg-success animate-pulse';
    case 'failed':
      return 'bg-destructive';
    case 'needs-auth':
      return 'bg-warning';
    default:
      // 'configured', 'disabled', 'idle-disconnected', or no status entry.
      return 'bg-muted-foreground/40';
  }
}

/**
 * Backend-grouped master list for the MCP Servers tab of Agents shell mode. Mirrors
 * SkillsTree's structure: one BackendGroup per backend, server rows with a leading
 * status dot and a trailing disabled tag.
 * Presentational only — data comes from useMcpServersByBackend via the parent.
 */
export function McpServersTree({
  backends,
  data,
  selection,
  expandedBackendIds,
  onToggleBackend,
  onSelectItem,
}: McpServersTreeProps) {
  return (
    <div className="space-y-1">
      {backends.map(backend => {
        const { backendId } = backend;

        return (
          <BackendGroup
            key={backendId}
            backend={backend}
            expanded={expandedBackendIds.includes(backendId)}
            onToggle={() => onToggleBackend(backendId)}
            createLabel="New MCP server"
            onCreate={() => onSelectItem({ backendId, kind: 'new-mcp-server' })}
          >
            {(() => {
              const servers = data.servers.get(backendId);
              const error = data.errors.get(backendId);

              if (!servers && data.loading) {
                return <TreeInfoRow>Loading…</TreeInfoRow>;
              }
              if (error) {
                return <TreeInfoRow>Couldn't load MCP servers</TreeInfoRow>;
              }
              if (!servers || servers.length === 0) {
                return <TreeInfoRow>No MCP servers</TreeInfoRow>;
              }

              const statuses = data.statuses.get(backendId);

              return servers.map(server => {
                const isSelected =
                  selection?.kind === 'mcp-server' &&
                  selection.backendId === backendId &&
                  selection.id === server.id;
                const isDisabled = server.enabled === false;

                return (
                  <button
                    key={server.id}
                    type="button"
                    onClick={() => onSelectItem({ backendId, kind: 'mcp-server', id: server.id })}
                    className={treeRowClass(isSelected)}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDotClass(
                        server,
                        statuses?.[server.name]
                      )}`}
                    />
                    <span className="truncate flex-1">{server.name}</span>
                    {isDisabled && (
                      <span className="text-[10px] text-muted-foreground/60 shrink-0">
                        disabled
                      </span>
                    )}
                  </button>
                );
              });
            })()}
          </BackendGroup>
        );
      })}
    </div>
  );
}
