import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Lock, Unlock, X, FileText, FileEdit, FileDiff, Terminal as TerminalIcon, Plus } from 'lucide-react';
import { ModeSelector } from './ModeSelector';
import { PermissionSelector } from './PermissionSelector';
import { WorktreeSelector } from './WorktreeSelector';
import { TokenUsageDisplay } from './TokenUsageDisplay';
import { ComposerFooter } from './ComposerFooter';
import { MessageInput, type Attachment } from './MessageInput';
import { useServerStore } from '../../stores/serverStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { useFileViewerStore } from '../../stores/fileViewerStore';
import { usePluginStore } from '../../stores/pluginStore';
import { useProjectStore } from '../../stores/projectStore';
import { useDraftEditorStore } from '../../stores/draftEditorStore';
import { useChatStore } from '../../stores/chatStore';
import { useUIStore } from '../../stores/uiStore';
import { useSessionToolsStore, type SessionTool } from '../../stores/sessionToolsStore';
import { activatePanel, usePanelIsActive } from '../../utils/openPanel';
import * as api from '../../services/api';
import type { UnifiedPermissionPolicy, SlashCommand, Session, Project } from '@zclaudia/shared';
import type { ProviderCapabilities } from '@zclaudia/shared/core/runtime-capabilities';
import type { SessionDraft } from '../../stores/chatStore';

interface ChatInputAreaProps {
  sessionId: string;
  currentSession: Session;
  currentProject: Project | null | undefined;
  isMobile: boolean;
  isLoading: boolean;
  isConnected: boolean;
  isForcedPlanSession: boolean;
  mode: string;
  capabilities: ProviderCapabilities | null;
  permissionOverride: Partial<UnifiedPermissionPolicy> | null;
  commands: SlashCommand[];
  fileReferenceRoot: string | undefined;
  fileReferenceBackendId: string | null;
  sessionRunId: string | null;
  currentUsage: {
    inputTokens: number;
    outputTokens: number;
    latestInputTokens?: number;
    latestOutputTokens?: number;
    contextWindow?: number;
    contextWindowSource?: import('@zclaudia/shared').ContextWindowSource;
    contextWindowMatchedProvider?: string;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    latestCacheReadTokens?: number;
    latestCacheWriteTokens?: number;
  };
  advancedInput: boolean;
  restoreMessage: { content: string; attachments?: Attachment[] } | null;
  initialDraft: SessionDraft | undefined;
  draftExists: boolean;
  onSetMode: (sessionId: string, mode: string) => void;
  onSetPermissionOverride: (sessionId: string, policy: Partial<UnifiedPermissionPolicy> | null) => void;
  onWorktreeChange: (path: string) => Promise<void>;
  onSendMessage: (content: string, attachments?: Attachment[]) => void;
  onCancelRun: () => void;
  onCommand: (command: string, args: string) => Promise<void>;
}

export function ChatInputArea({
  sessionId,
  currentSession,
  currentProject,
  isMobile,
  isLoading,
  isConnected,
  isForcedPlanSession,
  mode,
  capabilities,
  permissionOverride,
  commands,
  fileReferenceRoot,
  fileReferenceBackendId,
  sessionRunId,
  currentUsage,
  advancedInput,
  restoreMessage,
  initialDraft,
  draftExists,
  onSetMode,
  onSetPermissionOverride,
  onWorktreeChange,
  onSendMessage,
  onCancelRun,
  onCommand,
}: ChatInputAreaProps) {
  const setDrawerOpen = useTerminalStore((s) => s.setDrawerOpen);
  const isDrawerOpen = useTerminalStore((s) => s.isDrawerOpen);
  const disabledBuiltinPanels = usePluginStore((s) => s.disabledBuiltinPanels);
  const fileViewerOpen = useFileViewerStore((s) => s.isOpen);
  const setAdvancedInput = useUIStore((s) => s.setAdvancedInput);
  const openDraftEditor = useDraftEditorStore((s) => s.openEditor);
  const setSendCallback = useDraftEditorStore((s) => s.setSendCallback);
  // Reactive active-tab checks (work for both bottom and right placement)
  const draftPanelActive = usePanelIsActive('draft');
  const fileViewerPanelActive = usePanelIsActive('file-viewer');
  const terminalPanelActive = usePanelIsActive('terminal');
  const changesPanelActive = usePanelIsActive('session-changes');

  // Tool panel open/close handlers — shared by the mobile toolbar and the desktop
  // right-sidebar pinned tab strip (published to the store below).
  const terminalProjectId = currentSession?.projectId;
  const terminalSupported = useServerStore.getState().activeServerSupports('remoteTerminal');
  const openDraftTool = useCallback(() => {
    if (draftPanelActive) {
      useDraftEditorStore.getState().closeEditor();
    } else {
      setSendCallback((content: string) => onSendMessage(content));
      openDraftEditor(sessionId);
    }
  }, [draftPanelActive, setSendCallback, onSendMessage, openDraftEditor, sessionId]);
  const openFilesTool = useCallback(() => {
    if (fileViewerPanelActive) {
      useFileViewerStore.getState().close();
    } else if (fileViewerOpen) {
      activatePanel('file-viewer');
    } else {
      const store = useFileViewerStore.getState();
      store.togglePanel();
      store.setSearchOpen(true);
      activatePanel('file-viewer');
    }
  }, [fileViewerPanelActive, fileViewerOpen]);
  const openChangesTool = useCallback(() => {
    const store = usePluginStore.getState();
    if (changesPanelActive) {
      store.updatePanelVisibility('session-changes', false);
    } else {
      store.updatePanelVisibility('session-changes', true);
      activatePanel('session-changes');
    }
  }, [changesPanelActive]);
  const openTerminalTool = useCallback(() => {
    if (!terminalProjectId) return;
    const open = isDrawerOpen(terminalProjectId);
    const active = open && terminalPanelActive;
    if (active) {
      setDrawerOpen(terminalProjectId, false);
    } else if (open) {
      activatePanel('terminal');
    } else {
      const store = useTerminalStore.getState();
      if (!store.getTerminalId(terminalProjectId)) {
        store.openTerminal(terminalProjectId);
      }
      setDrawerOpen(terminalProjectId, true);
      activatePanel('terminal');
    }
  }, [terminalProjectId, isDrawerOpen, terminalPanelActive, setDrawerOpen]);

  // The tool set for this session, in tab order: Draft / Files / Changes / Terminal.
  const sessionTools = useMemo<SessionTool[]>(() => {
    const tools: SessionTool[] = [];
    if (!disabledBuiltinPanels.includes('draft')) {
      tools.push({ id: 'draft', label: 'Draft', iconKey: 'draft', isActive: draftPanelActive, hasBadge: draftExists && !draftPanelActive, onClick: openDraftTool });
    }
    if (currentProject?.rootPath && !disabledBuiltinPanels.includes('file-viewer')) {
      tools.push({ id: 'file-viewer', label: 'Files', iconKey: 'file', isActive: fileViewerPanelActive, onClick: openFilesTool });
    }
    if (!disabledBuiltinPanels.includes('session-changes') && currentSession) {
      tools.push({ id: 'session-changes', label: 'Changes', iconKey: 'changes', isActive: changesPanelActive, onClick: openChangesTool });
    }
    if (!disabledBuiltinPanels.includes('terminal') && terminalSupported && terminalProjectId) {
      tools.push({ id: 'terminal', label: 'Terminal', iconKey: 'terminal', isActive: isDrawerOpen(terminalProjectId) && terminalPanelActive, onClick: openTerminalTool });
    }
    return tools;
  }, [disabledBuiltinPanels, draftPanelActive, draftExists, fileViewerPanelActive, changesPanelActive, terminalPanelActive, terminalSupported, terminalProjectId, isDrawerOpen, currentProject?.rootPath, currentSession, openDraftTool, openFilesTool, openChangesTool, openTerminalTool]);

  // Publish to the right-sidebar pinned strip (desktop only; mobile renders inline below).
  const setSessionTools = useSessionToolsStore((s) => s.setTools);
  useEffect(() => {
    if (isMobile) return;
    setSessionTools(sessionTools);
    return () => setSessionTools([]);
  }, [isMobile, sessionTools, setSessionTools]);

  // Mobile toolbar popover state
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const mobileToolsRef = useRef<HTMLDivElement>(null);

  // Close popover on outside tap
  useEffect(() => {
    if (!mobileToolsOpen) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (mobileToolsRef.current && !mobileToolsRef.current.contains(e.target as Node)) {
        setMobileToolsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [mobileToolsOpen]);

  const closeMobileTools = useCallback(() => setMobileToolsOpen(false), []);

  // One-shot prefill (e.g. from the plan "Execute plan" button). Takes
  // precedence over restoreMessage/initialDraft on its tick, then clears
  // itself so subsequent user edits aren't clobbered. `prefillConsumed`
  // gates the fallback sources after consumption so the user's in-progress
  // edits stay put (otherwise initialValue would revert to the draft and
  // overwrite them on the next MessageInput effect).
  const pendingPrefill = useChatStore((s) => s.pendingPrefills[sessionId]);
  const clearPendingPrefill = useChatStore((s) => s.clearPendingPrefill);
  const [prefillConsumed, setPrefillConsumed] = useState(false);

  useEffect(() => {
    setPrefillConsumed(false);
  }, [sessionId]);

  useEffect(() => {
    if (!pendingPrefill) return;
    setPrefillConsumed(false);
    const timer = setTimeout(() => {
      clearPendingPrefill(sessionId);
      setPrefillConsumed(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [pendingPrefill, sessionId, clearPendingPrefill]);

  const fallbackInitialValue = prefillConsumed
    ? undefined
    : restoreMessage?.content ?? initialDraft?.content;
  const messageInputInitialValue = pendingPrefill?.content ?? fallbackInitialValue;

  // Read-only mode
  if (currentSession.isReadOnly) {
    return (
      <div className="border-t border-border p-3 md:p-4 safe-bottom-pad flex-shrink-0">
        <div className="flex items-center justify-between gap-3 px-3 py-2.5 bg-secondary/50 border border-border rounded-lg">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Lock size={14} />
            <span>
              {currentSession.type === 'background'
                ? 'Background session — read-only'
                : currentSession.planStatus === 'planned'
                ? 'Plan submitted — waiting for Supervisor to execute'
                : currentSession.planStatus === 'executing'
                ? 'Task executing — controlled by Supervisor'
                : 'This session is read-only'}
            </span>
          </div>
          {currentSession.type === 'background' ? (
            isLoading && sessionRunId ? (
              <button
                onClick={onCancelRun}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-destructive/10 text-destructive hover:bg-destructive/20 rounded-md transition-colors"
              >
                <X size={14} />
                Cancel
              </button>
            ) : null
          ) : (
            <button
              onClick={async () => {
                try {
                  const updated = await api.unlockSession(sessionId);
                  useProjectStore.getState().updateSession(sessionId, {
                    isReadOnly: updated.isReadOnly,
                    planStatus: updated.planStatus,
                  });
                } catch (err) {
                  console.error('Failed to unlock session:', err);
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary/10 text-primary hover:bg-primary/20 rounded-md transition-colors"
            >
              <Unlock size={14} />
              Unlock
            </button>
          )}
        </div>
      </div>
    );
  }

  // Normal input mode
  const selectorTrio = (
    <>
      {capabilities && (
        <ModeSelector
          capabilities={capabilities}
          value={isForcedPlanSession ? 'plan' : mode}
          onChange={(m) => {
            if (isForcedPlanSession) return;
            onSetMode(sessionId, m);
          }}
          disabled={isLoading}
          locked={isForcedPlanSession}
          lockReason={isForcedPlanSession ? 'Locked by Supervisor planning mode' : undefined}
        />
      )}
      <PermissionSelector
        value={permissionOverride}
        onChange={(policy) => onSetPermissionOverride(sessionId, policy)}
        disabled={isLoading}
      />
      {currentProject?.id && currentProject?.rootPath && (
        <WorktreeSelector
          projectId={currentProject.id}
          projectRootPath={currentProject.rootPath}
          currentWorktree={currentSession?.workingDirectory || ''}
          onChange={onWorktreeChange}
          disabled={isLoading}
          locked={isForcedPlanSession}
          lockReason={isForcedPlanSession ? 'Locked by Supervisor planning mode' : undefined}
        />
      )}
    </>
  );

  return (
    <div className="p-2 pb-3 md:px-4 md:pb-3 md:pt-2 safe-bottom-pad overflow-visible flex-shrink-0">
      {/* Mobile-only toolbar: three selectors, JS-gated to mobile only */}
      {isMobile && (
        <div className="mb-1.5 flex items-center gap-1">{selectorTrio}</div>
      )}
      <MessageInput
        key={sessionId}
        sessionId={sessionId}
        onSend={onSendMessage}
        onCancel={onCancelRun}
        onCommand={onCommand}
        commands={commands}
        projectRoot={fileReferenceRoot}
        backendId={fileReferenceBackendId}
        disabled={!isConnected}
        isLoading={isLoading}
        initialValue={messageInputInitialValue}
        initialAttachments={restoreMessage?.attachments ?? initialDraft?.attachments}
        advancedMode={advancedInput}
        onRequestAdvancedMode={!isMobile && !advancedInput ? () => setAdvancedInput(true) : undefined}
        mobileToolbarSlot={isMobile ? (() => {
          const toolItems: Array<{ key: string; icon: React.ReactNode; label: string; isActive: boolean; hasBadge?: boolean; onClick: () => void }> = [];

          if (!disabledBuiltinPanels.includes('draft')) {
            const isActive = draftPanelActive;
            toolItems.push({
              key: 'draft',
              icon: <FileEdit size={18} strokeWidth={1.75} />,
              label: isActive ? 'Close Draft' : 'Draft Editor',
              isActive,
              hasBadge: draftExists && !isActive,
              onClick: () => {
                if (isActive) {
                  useDraftEditorStore.getState().closeEditor();
                } else {
                  setSendCallback((content: string) => onSendMessage(content));
                  openDraftEditor(sessionId);
                }
                closeMobileTools();
              },
            });
          }

          if (currentProject?.rootPath && !disabledBuiltinPanels.includes('file-viewer')) {
            const isActive = fileViewerPanelActive;
            toolItems.push({
              key: 'file-viewer',
              icon: <FileText size={18} strokeWidth={1.75} />,
              label: isActive ? 'Close Files' : 'File Viewer',
              isActive,
              onClick: () => {
                if (isActive) {
                  useFileViewerStore.getState().close();
                } else if (fileViewerOpen) {
                  activatePanel('file-viewer');
                } else {
                  const store = useFileViewerStore.getState();
                  store.togglePanel();
                  store.setSearchOpen(true);
                  activatePanel('file-viewer');
                }
                closeMobileTools();
              },
            });
          }

          if (!disabledBuiltinPanels.includes('session-changes') && currentSession) {
            const isActive = changesPanelActive;
            toolItems.push({
              key: 'session-changes',
              icon: <FileDiff size={18} strokeWidth={1.75} />,
              label: isActive ? 'Hide Changes' : 'Session Changes',
              isActive,
              onClick: () => {
                const store = usePluginStore.getState();
                if (isActive) {
                  store.updatePanelVisibility('session-changes', false);
                } else {
                  store.updatePanelVisibility('session-changes', true);
                  activatePanel('session-changes');
                }
                closeMobileTools();
              },
            });
          }

          if (!disabledBuiltinPanels.includes('terminal') && useServerStore.getState().activeServerSupports('remoteTerminal') && currentSession?.projectId) {
            const pid = currentSession.projectId;
            const isOpen = isDrawerOpen(pid);
            const isActive = isOpen && terminalPanelActive;
            toolItems.push({
              key: 'terminal',
              icon: <TerminalIcon size={18} strokeWidth={1.75} />,
              label: isActive ? 'Hide Terminal' : 'Terminal',
              isActive,
              onClick: () => {
                if (isActive) {
                  setDrawerOpen(pid, false);
                } else if (isOpen) {
                  activatePanel('terminal');
                } else {
                  const store = useTerminalStore.getState();
                  if (!store.getTerminalId(pid)) {
                    store.openTerminal(pid);
                  }
                  setDrawerOpen(pid, true);
                  activatePanel('terminal');
                }
                closeMobileTools();
              },
            });
          }

          if (toolItems.length === 0) return undefined;

          const hasActiveItem = toolItems.some(t => t.isActive);
          const hasBadge = toolItems.some(t => t.hasBadge);

          return (
            <div className="flex items-center gap-1.5">
              {toolItems.length > 0 && (
                <div className="relative" ref={mobileToolsRef}>
                  <button
                    onClick={() => setMobileToolsOpen(v => !v)}
                    className={`h-10 w-10 flex-shrink-0 flex items-center justify-center rounded-full transition-colors relative ${hasActiveItem ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                    title="More tools"
                  >
                    <Plus size={20} strokeWidth={1.75} className={`transition-transform duration-200 ${mobileToolsOpen ? 'rotate-45' : ''}`} />
                    {hasBadge && (
                      <span className="absolute top-1 right-1 w-2 h-2 bg-primary rounded-full" />
                    )}
                  </button>
                  {mobileToolsOpen && (
                    <div className="absolute bottom-full left-0 mb-2 py-1 bg-popover border border-border rounded-xl shadow-lg min-w-[160px] z-50">
                      {toolItems.map((item) => (
                        <button
                          key={item.key}
                          onClick={item.onClick}
                          className={`w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors ${item.isActive ? 'text-primary bg-primary/5' : 'text-foreground hover:bg-muted'}`}
                        >
                          <span className="relative flex-shrink-0">
                            {item.icon}
                            {item.hasBadge && (
                              <span className="absolute -top-1 -right-1 w-2 h-2 bg-primary rounded-full" />
                            )}
                          </span>
                          {item.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })() : undefined}
        onToggleAdvanced={!isMobile ? () => setAdvancedInput(!advancedInput) : undefined}
        placeholder={
          !isConnected
            ? 'Connecting...'
            : isLoading
            ? 'Type to steer mid-run (delivered next turn)...'
            : (isForcedPlanSession || mode === 'plan')
            ? 'Plan Mode: Analyze and plan (no code changes)...'
            : advancedInput
            ? 'Type a message  ·  / commands  ·  @ files  ·  Cmd+Enter to send'
            : 'Type a message  ·  / commands  ·  @ files'
        }
      />
      {!isMobile && (
        <ComposerFooter
          left={selectorTrio}
          right={
            <TokenUsageDisplay
              latestInputTokens={currentUsage.latestInputTokens}
              latestOutputTokens={currentUsage.latestOutputTokens}
              inputTokens={currentUsage.inputTokens}
              outputTokens={currentUsage.outputTokens}
              contextWindow={currentUsage.contextWindow}
              contextWindowSource={currentUsage.contextWindowSource}
              contextWindowMatchedProvider={currentUsage.contextWindowMatchedProvider}
              cacheReadTokens={currentUsage.cacheReadTokens}
              cacheWriteTokens={currentUsage.cacheWriteTokens}
              latestCacheReadTokens={currentUsage.latestCacheReadTokens}
              latestCacheWriteTokens={currentUsage.latestCacheWriteTokens}
            />
          }
        />
      )}
    </div>
  );
}
