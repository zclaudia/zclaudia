import { SessionSettingsDialog } from './SessionSettingsDialog';
import { SessionActionsMenu } from './SessionActionsMenu';
import { IconButton } from '../../components/ui/Button';
import { WorkspaceChatControls } from '../../components/workspace/WorkspaceChatControls';
import { useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  Menu,
  WifiOff,
  Bot,
  Cpu,
  FolderOpen,
  PieChart,
  ChevronDown,
  Package,
  Shield,
  Key,
  Wrench,
  Monitor,
  Terminal,
  Users,
  PanelRight,
  MessageSquare,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Project } from '@zclaudia/shared/core/project';
import type { Session, SessionRuntimeEngine } from '@zclaudia/shared/core/session';
import type { SystemInfo } from '@zclaudia/shared/wire/messages/core';
import { useServerStore } from '../../stores/serverStore';
import { useRightSidebarStore } from '../../stores/rightSidebarStore';
import { pruneChat, useRightWorkspaceStore } from '../../stores/rightWorkspaceStore';
import { useWorkspacePane } from '../../components/workspace/WorkspaceContext';
import { useAgentForSession } from '../../hooks/useAgentForSession';
import { useAndroidBack } from '../../hooks/useAndroidBack';
import { useChatMessageStore } from '../../stores/chatMessageStore';
import { resolveTopicChip } from './sessionTopicChip';

const DEFAULT_AGENT_LABEL = 'Default Coding Agent';

// Context usage is only worth surfacing in the header when it's approaching the
// window limit; below this it just adds noise, so the pill hides it. The exact
// number is always available in the details popover.
const CONTEXT_WARN_PERCENT = 80;
const CONTEXT_DANGER_PERCENT = 95;

const isDesktopTauri =
  typeof window !== 'undefined' &&
  '__TAURI_INTERNALS__' in window &&
  !navigator.userAgent.includes('Android');

const isStandaloneSessionWindow =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('sessionWindow');

interface SessionHeaderProps {
  currentSession: Session;
  currentProject: Project | null | undefined;
  isMobile: boolean;
  isLoading: boolean;
  isRenamingSession: boolean;
  renameValue: string;
  showSessionMenu: boolean;
  onOpenSidebar?: () => void;
  onReturnToDashboard?: (projectId: string) => void;
  onRenameStart: (currentName: string) => void;
  onRenameChange: (value: string) => void;
  onRenameConfirm: () => void;
  onRenameCancel: () => void;
  onResetProviderSession: () => void;
  onExport: () => void;
  onArchive: () => void;
  archiveDisabled?: boolean;
  onPopOut: () => void;
  onToggleSessionMenu: () => void;
  contextPercent?: number | null;
  systemInfo?: SystemInfo | null;
  /**
   * Optional task-center entry (pill + popover), supplied by ChatInterface as
   * a slot. Rendered before the session-info chip for non-background
   * sessions; the header itself stays store- and connection-free, which keeps
   * its tests renderable without a ConnectionProvider.
   */
  taskCenter?: ReactNode;
}

export function SessionHeader({
  currentSession,
  currentProject,
  isMobile,
  isLoading,
  isRenamingSession,
  renameValue,
  showSessionMenu,
  onOpenSidebar,
  onReturnToDashboard,
  onRenameStart,
  onRenameChange,
  onRenameConfirm,
  onRenameCancel,
  onResetProviderSession,
  onExport,
  onArchive,
  archiveDisabled = false,
  onPopOut,
  onToggleSessionMenu,
  contextPercent = null,
  systemInfo = null,
  taskCenter,
}: SessionHeaderProps) {
  const workspacePane = useWorkspacePane();
  const [showSettings, setShowSettings] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showMobileInfo, setShowMobileInfo] = useState(false);
  // Hardware back closes the session-info overlay before any lower-priority
  // surface (sidebar drawer 10, agent overlay 20 — see useAndroidBack's guide).
  useAndroidBack(() => setShowMobileInfo(false), isMobile && showMobileInfo, 30);
  const activeServerId = useServerStore(s => s.activeServerId);
  const connectionQuality = useServerStore(s =>
    activeServerId ? s.connections[activeServerId]?.connectionQuality : undefined
  );
  const { agent } = useAgentForSession(currentSession?.id);
  const modelValue = systemInfo?.model || agent?.model || null;
  // Dual-mode run badge: the session keeps the engine mode (and connection
  // identity) it was bound to at first run — from session_runtime_bindings —
  // even if the agent profile has since switched modes. Sessions that never
  // ran have no binding and show no badge.
  const runtimeEngine = currentSession?.runtimeEngine;
  const engineBadge = runtimeEngine
    ? runtimeEngine.engineMode === 'sdk'
      ? ['SDK', runtimeEngine.llmProfileName, runtimeEngine.model].filter(Boolean).join(' · ')
      : 'CLI'
    : null;
  // The pill shows only the agent name to stay compact; the model is redundant
  // here since it's spelled out in the details popover. Fall back to a generic
  // placeholder during the brief first-render window before the store hydrates.
  const agentLabel = agent?.name ?? DEFAULT_AGENT_LABEL;
  const pathValue = systemInfo?.cwd || currentSession?.workingDirectory || null;

  // Topic anchor chip: first user message in the session
  const firstUserText = useChatMessageStore(s => {
    const msgs = s.messages[currentSession.id];
    return msgs?.find(m => m.role === 'user')?.content ?? null;
  });
  const topicText = firstUserText ? firstUserText.replace(/\s+/g, ' ').trim().slice(0, 40) : null;
  const chipText = resolveTopicChip(currentSession.autoTitle, topicText, currentSession.name);

  // Right-panel toggle — a persistent affordance on desktop (like Cursor's panel toggle).
  const rightCollapsed = useRightSidebarStore(s => s.collapsed);
  const rightUnread = useRightSidebarStore(s => s.unread);
  const toggleRightPanel = useRightSidebarStore(s => s.toggleCollapsed);
  const rightWorkspaceHasContent = useRightWorkspaceStore(
    s =>
      pruneChat(s.bySession[workspacePane?.workspaceId ?? currentSession.id]?.root ?? null) !== null
  );
  const showRightToggle = !isMobile && currentSession.type !== 'background';
  const rightExpanded = !rightCollapsed;
  const handleToggleRightPanel = () => {
    toggleRightPanel();
  };

  return (
    <div className="zc-session-header relative flex min-h-[48px] items-center gap-2.5 px-3 py-0 sm:min-h-[36px] sm:px-3.5 sm:py-0 bg-background safe-top-pad">
      <div className="absolute inset-x-0 top-0 hidden h-2 sm:block" data-tauri-drag-region />
      {/* Mobile: hamburger menu */}
      {isMobile && onOpenSidebar && (
        <IconButton onClick={onOpenSidebar} aria-label="Open menu">
          <Menu className="h-5 w-5" strokeWidth={1.75} />
        </IconButton>
      )}
      {/* Back button for background sessions */}
      {currentSession.type === 'background' && onReturnToDashboard && currentSession.projectId && (
        <button
          onClick={() => onReturnToDashboard(currentSession.projectId)}
          className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors shrink-0"
          title="Back to dashboard"
          aria-label="Back to dashboard"
        >
          <ArrowLeft size={14} />
        </button>
      )}
      {/* Session name — click to rename (disabled for background sessions) */}
      {currentSession.type === 'background' ? (
        <div className="flex min-w-0 max-w-[520px] items-center self-stretch">
          <span className="flex min-w-0 items-center truncate text-[13px] font-semibold leading-none text-foreground">
            {currentSession.name || 'Untitled Session'}
          </span>
        </div>
      ) : isRenamingSession ? (
        <input
          autoFocus
          type="text"
          value={renameValue}
          onChange={e => onRenameChange(e.target.value)}
          onKeyDown={e => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === 'Enter') onRenameConfirm();
            if (e.key === 'Escape') onRenameCancel();
          }}
          onBlur={onRenameConfirm}
          className="w-full min-w-0 max-w-[min(56vw,880px)] px-2 py-0 text-[13px] font-semibold leading-none bg-muted/60 border-0 rounded-md shadow-apple-sm focus:ring-1 focus:ring-primary/50 focus:outline-none text-foreground"
        />
      ) : (
        <div className="flex min-w-0 max-w-[520px] items-center self-stretch">
          <button
            onClick={() => onRenameStart(currentSession.name || '')}
            className="flex h-full min-w-0 max-w-full items-center truncate text-left text-[13px] font-semibold leading-none text-foreground hover:text-primary transition-colors"
            title="Click to rename"
          >
            {currentSession.name || 'Untitled Session'}
          </button>
        </div>
      )}
      {currentSession.type !== 'background' && chipText && (
        <span
          className="zc-session-topic hidden min-w-0 shrink items-center gap-1 rounded-md bg-muted/60 px-2 py-0.5 text-[11px] leading-none text-muted-foreground sm:inline-flex"
          title={firstUserText ?? undefined}
        >
          <MessageSquare size={11} className="shrink-0" />
          <span className="truncate">{chipText}</span>
        </span>
      )}
      {/* Flexible spacer: pins the trailing actions (mobile "…" menu included)
          to the right edge instead of trailing the title. */}
      <div className="min-w-0 flex-1 self-stretch sm:min-w-6" data-tauri-drag-region />
      {/* Task center entry — same chip family as session info, before it */}
      {currentSession.type !== 'background' && taskCenter}
      {/* Session info chip — agent/model + context%, opens a details popover.
          md: (not sm:) so the CSS gate matches useIsMobile's 768px breakpoint;
          below that, session info lives in the mobile "…" menu instead. */}
      {currentSession.type !== 'background' && (
        <div className="relative hidden shrink-0 md:block">
          <button
            onClick={() => setShowInfo(v => !v)}
            className={`inline-flex max-w-[260px] items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] leading-none transition-colors ${showInfo ? 'border-border bg-secondary text-foreground' : 'border-border/70 bg-muted/40 text-muted-foreground hover:text-foreground'}`}
            title="Session info"
            aria-haspopup="dialog"
            aria-expanded={showInfo}
          >
            <Cpu size={12} className="shrink-0" />
            {/* leading-tight (not the pill's leading-none) so truncate's
                overflow:hidden doesn't clip descenders like the "g" in "Coding" */}
            <span className="zc-session-agent-label truncate leading-tight">{agentLabel}</span>
            {engineBadge && (
              <span
                className="zc-session-engine-badge max-w-[140px] shrink-0 truncate rounded bg-muted px-1 py-0.5 text-[10px] font-medium text-muted-foreground"
                title={`Session run mode: ${engineBadge}`}
              >
                {engineBadge}
              </span>
            )}
            {agent?.status === 'readonly' && (
              <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] font-medium text-muted-foreground">
                read-only
              </span>
            )}
            {contextPercent != null && contextPercent >= CONTEXT_WARN_PERCENT && (
              <span
                className={`shrink-0 font-medium ${contextPercent >= CONTEXT_DANGER_PERCENT ? 'text-destructive' : 'text-warning'}`}
              >
                · {contextPercent}%
              </span>
            )}
            <ChevronDown size={11} className="shrink-0 opacity-70" />
          </button>
          {showInfo && (
            <>
              <div className="fixed inset-0 z-[70]" onClick={() => setShowInfo(false)} />
              <div
                role="dialog"
                className="absolute right-0 top-full z-[80] mt-1.5 w-80 max-w-[90vw] overflow-hidden rounded-xl border border-border/80 bg-card shadow-xl"
              >
                <div
                  className="truncate px-3 pt-3 pb-2 text-[13px] font-semibold text-foreground"
                  title={currentSession.name || 'Untitled Session'}
                >
                  {currentSession.name || 'Untitled Session'}
                </div>
                <SessionInfoRows
                  agentName={agent?.name ?? DEFAULT_AGENT_LABEL}
                  modelValue={modelValue}
                  systemInfo={systemInfo}
                  pathValue={pathValue}
                  contextPercent={contextPercent}
                />
              </div>
            </>
          )}
        </div>
      )}
      {/* currentProject is retained on the props contract — T4 will use it to surface
          agent / project metadata in a richer header layout. */}
      <span className="hidden" data-stub-project-id={currentProject?.id} />
      {connectionQuality === 'degraded' && (
        <div
          className="flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-xs font-medium text-warning shrink-0"
          title="Backend may be unresponsive — heartbeat timeout"
        >
          <WifiOff size={10} />
          <span className="hidden sm:inline">Unstable</span>
        </div>
      )}
      {showSettings && (
        <SessionSettingsDialog
          sessionId={currentSession.id}
          disabled={isLoading || currentSession.isReadOnly}
          isMobile={isMobile}
          onClose={() => setShowSettings(false)}
        />
      )}
      {/* Actions (hidden for background sessions) */}
      {currentSession.type !== 'background' && (
        <>
          <SessionActionsMenu
            open={showSessionMenu}
            onOpenChange={open => {
              if (open !== showSessionMenu) onToggleSessionMenu();
            }}
            isMobile={isMobile}
            isLoading={isLoading}
            archiveDisabled={archiveDisabled}
            canPopOut={!isMobile && isDesktopTauri && !isStandaloneSessionWindow}
            onInfo={() => setShowMobileInfo(true)}
            onSettings={() => setShowSettings(true)}
            onReset={onResetProviderSession}
            onExport={onExport}
            onArchive={onArchive}
            onPopOut={onPopOut}
          />
          {/* Mobile: collapse actions into "..." dropdown */}
          {isMobile && (
            <>
              {/* Mobile session-info overlay — same content as the desktop info
                  popover, sized for phones and dismissed by backdrop tap or the
                  close button. */}
              {showMobileInfo && (
                <>
                  <div
                    className="fixed inset-0 z-[90] bg-black/40"
                    onClick={() => setShowMobileInfo(false)}
                  />
                  <div
                    role="dialog"
                    aria-label="Session info"
                    data-testid="session-info-overlay"
                    className="fixed inset-x-3 top-[calc(env(safe-area-inset-top,0px)+56px)] z-[95] overflow-hidden rounded-xl border border-border/80 bg-card shadow-xl"
                  >
                    <div className="flex min-h-[44px] items-center gap-2 pl-3 pr-1">
                      <div
                        className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground"
                        title={currentSession.name || 'Untitled Session'}
                      >
                        {currentSession.name || 'Untitled Session'}
                      </div>
                      <button
                        onClick={() => setShowMobileInfo(false)}
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
                        aria-label="Close session info"
                      >
                        <X size={16} strokeWidth={1.75} />
                      </button>
                    </div>
                    <SessionInfoRows
                      agentName={agent?.name ?? DEFAULT_AGENT_LABEL}
                      modelValue={modelValue}
                      runtimeEngine={engineBadge ? runtimeEngine : undefined}
                      systemInfo={systemInfo}
                      pathValue={pathValue}
                      contextPercent={contextPercent}
                    />
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
      {/* Pane controls (workspace only) sit with the other trailing actions, never before the title */}
      <WorkspaceChatControls />
      {/* Right-panel toggle (desktop) — far-right edge, beside the "..." menu */}
      {showRightToggle && (
        <button
          onClick={handleToggleRightPanel}
          className={`relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors ${rightExpanded ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}
          title={rightExpanded ? 'Hide panel' : 'Show panel'}
          aria-label={rightExpanded ? 'Hide right panel' : 'Show right panel'}
          aria-pressed={rightExpanded}
        >
          <PanelRight size={16} strokeWidth={1.75} />
          {!rightExpanded && rightWorkspaceHasContent && rightUnread && (
            <span className="zc-workspace-unread absolute right-1 top-1 h-2 w-2 rounded-full bg-primary ring-2 ring-background" />
          )}
        </button>
      )}
    </div>
  );
}

/**
 * Shared body of the session-info surfaces: the desktop header popover and the
 * mobile "Session info" overlay render the same rows from here.
 */
function SessionInfoRows({
  agentName,
  modelValue,
  runtimeEngine,
  systemInfo,
  pathValue,
  contextPercent,
}: {
  agentName: string;
  modelValue: string | null;
  runtimeEngine?: SessionRuntimeEngine;
  systemInfo: SystemInfo | null;
  pathValue: string | null;
  contextPercent: number | null;
}) {
  const engineModeValue = runtimeEngine
    ? [
        runtimeEngine.engineMode === 'sdk' ? 'SDK' : runtimeEngine.engineMode.toUpperCase(),
        runtimeEngine.llmProfileName,
        runtimeEngine.model,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;
  return (
    <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto px-3 pb-3 text-xs">
      <InfoRow icon={Bot} label="Agent" value={agentName} />
      {engineModeValue && <InfoRow icon={Package} label="Run mode" value={engineModeValue} />}
      {modelValue && <InfoRow icon={Cpu} label="Model" value={modelValue} />}
      {systemInfo?.claudeCodeVersion && (
        <InfoRow icon={Package} label="Version" value={systemInfo.claudeCodeVersion} />
      )}
      {systemInfo?.permissionMode && (
        <InfoRow icon={Shield} label="Perms" value={systemInfo.permissionMode} />
      )}
      {/* "Auth", not "API key": runtimes report a credential *source*, which is
          often an account login rather than a key. */}
      {systemInfo?.apiKeySource && (
        <InfoRow icon={Key} label="Auth" value={systemInfo.apiKeySource} />
      )}
      {pathValue && <InfoRow icon={FolderOpen} label="Path" value={pathValue} mono />}
      {contextPercent != null && (
        <InfoRow icon={PieChart} label="Context" value={`${contextPercent}%`} />
      )}
      {systemInfo?.tools && systemInfo.tools.length > 0 && (
        <InfoChips icon={Wrench} label="Tools" items={systemInfo.tools} />
      )}
      {systemInfo?.mcpServers && systemInfo.mcpServers.length > 0 && (
        <InfoChips icon={Monitor} label="MCP Servers" items={systemInfo.mcpServers} />
      )}
      {systemInfo?.slashCommands && systemInfo.slashCommands.length > 0 && (
        <InfoChips icon={Terminal} label="Commands" items={systemInfo.slashCommands} />
      )}
      {systemInfo?.agents && systemInfo.agents.length > 0 && (
        <InfoChips icon={Users} label="Agents" items={systemInfo.agents} />
      )}
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
  mono = false,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon size={14} className="shrink-0 text-muted-foreground" />
      <span className="w-12 shrink-0 text-muted-foreground">{label}</span>
      <span
        className={`min-w-0 flex-1 truncate text-right text-foreground ${mono ? 'font-mono text-[11px]' : ''}`}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function InfoChips({
  icon: Icon,
  label,
  items,
}: {
  icon: LucideIcon;
  label: string;
  items: (string | { name: string; status?: string })[];
}) {
  const [showAll, setShowAll] = useState(false);
  const maxVisible = 6;
  const display = showAll ? items : items.slice(0, maxVisible);
  const hasMore = items.length > maxVisible;
  return (
    <div>
      <div className="mb-1 flex items-center gap-2 text-muted-foreground">
        <Icon size={14} className="shrink-0" />
        <span>{label}</span>
        <span className="text-muted-foreground/70">({items.length})</span>
      </div>
      <div className="ml-6 flex flex-wrap gap-1">
        {display.map((item, i) => (
          <span
            key={i}
            className="rounded-md bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-secondary-foreground"
          >
            {typeof item === 'string' ? item : item.name}
          </span>
        ))}
        {hasMore && (
          <button
            onClick={() => setShowAll(v => !v)}
            className="text-[10px] text-primary hover:underline"
          >
            {showAll ? 'show less' : `+${items.length - maxVisible} more`}
          </button>
        )}
      </div>
    </div>
  );
}
