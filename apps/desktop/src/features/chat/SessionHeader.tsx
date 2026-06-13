import { useState } from 'react';
import { RotateCcw, Download, ExternalLink, Archive, ArrowLeft, MoreHorizontal, WifiOff, Bot, Cpu, FolderOpen, PieChart, ChevronDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Session, Project } from '@zclaudia/shared';
import { useServerStore } from '../../stores/serverStore';
import { useAgentForSession } from '../../hooks/useAgentForSession';

const DEFAULT_AGENT_LABEL = 'Default Coding Agent';

const isDesktopTauri = typeof window !== 'undefined'
  && '__TAURI_INTERNALS__' in window
  && !navigator.userAgent.includes('Android');

const isStandaloneSessionWindow = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).has('sessionWindow');

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
}: SessionHeaderProps) {
  const [showInfo, setShowInfo] = useState(false);
  const activeServerId = useServerStore(s => s.activeServerId);
  const connectionQuality = useServerStore(s =>
    activeServerId ? s.connections[activeServerId]?.connectionQuality : undefined,
  );
  const { agent } = useAgentForSession(currentSession?.id);
  // Show "Agent Name (model)" once the agent resolves; fall back to a generic
  // placeholder during the brief first-render window before the store hydrates.
  const agentLabel = agent
    ? `${agent.name} (${agent.model})`
    : DEFAULT_AGENT_LABEL;

  return (
    <div
      className="flex min-h-[48px] items-center gap-2.5 px-3 py-0 sm:min-h-[36px] sm:px-3.5 sm:py-0 bg-background safe-top-pad"
      data-tauri-drag-region
    >
      {/* Mobile: hamburger menu */}
      {isMobile && onOpenSidebar && (
        <button
          onClick={onOpenSidebar}
          className="flex h-8 w-8 -ml-1 items-center justify-center rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground flex-shrink-0"
          aria-label="Open menu"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      )}
      {/* Back button for background sessions */}
      {currentSession.type === 'background' && onReturnToDashboard && currentSession.projectId && (
        <button
          onClick={() => onReturnToDashboard(currentSession.projectId)}
          className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors shrink-0"
          title="Back to dashboard"
        >
          <ArrowLeft size={14} />
        </button>
      )}
      {/* Session name — click to rename (disabled for background sessions) */}
      {currentSession.type === 'background' ? (
        <div className="flex flex-1 min-w-0 items-center self-stretch">
          <span className="flex min-w-0 items-center truncate text-[13px] font-semibold leading-none text-foreground">
            {currentSession.name || 'Untitled Session'}
          </span>
        </div>
      ) : isRenamingSession ? (
        <input
          autoFocus
          type="text"
          value={renameValue}
          onChange={(e) => onRenameChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onRenameConfirm();
            if (e.key === 'Escape') onRenameCancel();
          }}
          onBlur={onRenameConfirm}
          className="flex-1 min-w-0 px-2 py-0 text-[13px] font-semibold leading-none bg-muted/60 border-0 rounded-lg shadow-apple-sm focus:ring-1 focus:ring-primary/50 focus:outline-none text-foreground"
        />
      ) : (
        <div className="flex flex-1 min-w-0 items-center self-stretch">
          <button
            onClick={() => onRenameStart(currentSession.name || '')}
            className="flex h-full w-full min-w-0 items-center truncate text-left text-[13px] font-semibold leading-none text-foreground hover:text-primary transition-colors"
            title="Click to rename"
          >
            {currentSession.name || 'Untitled Session'}
          </button>
        </div>
      )}
      {/* Session info chip — agent/model + context%, opens a details popover */}
      {currentSession.type !== 'background' && (
        <div className="relative hidden shrink-0 sm:block">
          <button
            onClick={() => setShowInfo((v) => !v)}
            className={`inline-flex max-w-[260px] items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] leading-none transition-colors ${showInfo ? 'border-border bg-secondary text-foreground' : 'border-border/70 bg-muted/40 text-muted-foreground hover:text-foreground'}`}
            title="Session info"
            aria-haspopup="dialog"
            aria-expanded={showInfo}
          >
            <Cpu size={12} className="shrink-0" />
            <span className="truncate">{agentLabel}</span>
            {contextPercent != null && (
              <span className="shrink-0 text-muted-foreground/80">· {contextPercent}%</span>
            )}
            <ChevronDown size={11} className="shrink-0 opacity-70" />
          </button>
          {showInfo && (
            <>
              <div className="fixed inset-0 z-[70]" onClick={() => setShowInfo(false)} />
              <div
                role="dialog"
                className="absolute right-0 top-full z-[80] mt-1.5 w-64 rounded-xl border border-border/80 bg-card p-3 shadow-xl"
              >
                <div
                  className="mb-2 truncate text-[13px] font-semibold text-foreground"
                  title={currentSession.name || 'Untitled Session'}
                >
                  {currentSession.name || 'Untitled Session'}
                </div>
                <div className="flex flex-col gap-2 text-xs">
                  <InfoRow icon={Bot} label="Agent" value={agent?.name ?? DEFAULT_AGENT_LABEL} />
                  {agent?.model && <InfoRow icon={Cpu} label="Model" value={agent.model} />}
                  {currentSession.workingDirectory && (
                    <InfoRow icon={FolderOpen} label="Path" value={currentSession.workingDirectory} mono />
                  )}
                  {contextPercent != null && (
                    <InfoRow icon={PieChart} label="Context" value={`${contextPercent}%`} />
                  )}
                </div>
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
          className="flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[9px] font-medium text-warning shrink-0"
          title="Backend may be unresponsive — heartbeat timeout"
        >
          <WifiOff size={10} />
          <span className="hidden sm:inline">Unstable</span>
        </div>
      )}
      {/* Actions (hidden for background sessions) */}
      {currentSession.type !== 'background' && (
        <>
          {/* Desktop: collapse low-frequency actions into a "..." menu */}
          {!isMobile && (
            <div className="relative shrink-0">
              <button
                onClick={onToggleSessionMenu}
                className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${showSessionMenu ? 'bg-secondary text-foreground' : 'hover:bg-secondary text-muted-foreground hover:text-foreground'}`}
                title="Session actions"
                aria-label="Session actions"
                aria-haspopup="menu"
                aria-expanded={showSessionMenu}
              >
                <MoreHorizontal size={16} strokeWidth={1.75} />
              </button>
              {showSessionMenu && (
                <>
                  <div className="fixed inset-0 z-[70]" onClick={onToggleSessionMenu} />
                  <div
                    role="menu"
                    className="absolute right-0 top-full z-[80] mt-1 min-w-[190px] overflow-hidden rounded-xl border border-border/80 bg-card py-1 shadow-xl"
                  >
                    <button
                      role="menuitem"
                      onClick={() => { onResetProviderSession(); onToggleSessionMenu(); }}
                      disabled={isLoading}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <RotateCcw size={14} className="text-muted-foreground" />
                      Reset session
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => { onExport(); onToggleSessionMenu(); }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-foreground hover:bg-secondary"
                    >
                      <Download size={14} className="text-muted-foreground" />
                      Export as Markdown
                    </button>
                    {isDesktopTauri && !isStandaloneSessionWindow && (
                      <button
                        role="menuitem"
                        onClick={() => { onPopOut(); onToggleSessionMenu(); }}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-foreground hover:bg-secondary"
                      >
                        <ExternalLink size={14} className="text-muted-foreground" />
                        Open in new window
                      </button>
                    )}
                    <div className="my-1 h-px bg-border" />
                    <button
                      role="menuitem"
                      onClick={() => { onArchive(); onToggleSessionMenu(); }}
                      disabled={archiveDisabled}
                      title={archiveDisabled ? 'Stop the run before archiving' : undefined}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/8 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      <Archive size={14} />
                      Archive session
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          {/* Mobile: collapse actions into "..." dropdown */}
          {isMobile && (
            <div className="relative shrink-0">
              <button
                onClick={onToggleSessionMenu}
                className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="Session actions"
              >
                <MoreHorizontal size={16} strokeWidth={1.75} />
              </button>
              {showSessionMenu && (
                <>
                  <div className="fixed inset-0 z-[70]" onClick={onToggleSessionMenu} />
                  <div className="fixed right-3 top-[calc(env(safe-area-inset-top,0px)+42px)] z-[80] min-w-[180px] overflow-hidden rounded-xl border border-border/80 bg-card shadow-2xl">
                    <button
                      onClick={() => { onResetProviderSession(); onToggleSessionMenu(); }}
                      disabled={isLoading}
                      className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 text-foreground hover:bg-muted disabled:opacity-50"
                    >
                      <RotateCcw size={14} />
                      Reset Session
                    </button>
                    <button
                      onClick={() => { onExport(); onToggleSessionMenu(); }}
                      className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 text-foreground hover:bg-muted"
                    >
                      <Download size={14} />
                      Export Markdown
                    </button>
                    <button
                      onClick={() => { onArchive(); onToggleSessionMenu(); }}
                      disabled={archiveDisabled}
                      title={archiveDisabled ? 'Stop the run before archiving' : undefined}
                      className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 text-foreground hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                    >
                      <Archive size={14} />
                      Archive
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </>
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
