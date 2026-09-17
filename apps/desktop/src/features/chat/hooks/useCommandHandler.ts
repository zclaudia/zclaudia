import { DEFAULT_AGENT_RUNTIME } from '@zclaudia/shared/core/agent-profile';
import {
  dispatchClientAction,
  hasClientAction,
  legacyAliasToHostActionName,
  setClientActionContextFactory,
  type ClientActionContext,
} from '../clientActions';
import '../clientActionDefinitions';
import { useCallback } from 'react';
import { useProjectStore } from '../../../stores/projectStore';
import { useLlmProfileMetaStore } from '../../../stores/llmProfileMetaStore';
import { useRunStore } from '../../../stores/runStore';
import { useSessionConfigStore } from '../../../stores/sessionConfigStore';
import { activatePanel } from '../../../actions/openPanel';
import * as api from '../../../services/api';
import { finalizeRunLifecycle } from '../../../services/message-handlers/run-finalization';
import type {
  CommandExecuteResponse,
  SlashCommand,
  Session,
  Project,
  MessageRole,
  MessageMetadata,
} from '@zclaudia/shared';

interface UseCommandHandlerParams {
  sessionId: string;
  commands: SlashCommand[];
  currentSession: Session | undefined;
  currentProject: Project | null | undefined;
  isForcedPlanSession: boolean;
  mode: string;
  addMessage: (
    sessionId: string,
    message: {
      id: string;
      clientMessageId?: string;
      sessionId: string;
      role: MessageRole;
      content: string;
      metadata?: MessageMetadata;
      createdAt: number;
    }
  ) => void;
  clearMessages: (sessionId: string) => void;
  scrollToBottom: () => void;
  startRun: (msg: {
    type: 'run_start';
    clientRequestId: string;
    sessionId: string;
    input: string;
    resend?: boolean;
    mode?: string;
    workingDirectory?: string;
  }) => Promise<void>;
  llmProfileId: string | undefined;
  commandsCacheKey: string;
  setDrawerOpen: (projectId: string, open: boolean) => void;
}

export function useCommandHandler({
  sessionId,
  commands,
  currentSession,
  currentProject,
  isForcedPlanSession,
  mode,
  addMessage,
  clearMessages,
  scrollToBottom,
  startRun,
  llmProfileId,
  commandsCacheKey,
  setDrawerOpen,
}: UseCommandHandlerParams) {
  // Handle built-in command response
  const handleBuiltInCommand = useCallback(
    (result: CommandExecuteResponse) => {
      const { action, data, command: cmdName } = result;

      switch (action) {
        case 'clear':
          clearMessages(sessionId);
          addMessage(sessionId, {
            id: crypto.randomUUID(),
            sessionId,
            role: 'system',
            content: (data?.message as string) || 'Chat history cleared.',
            createdAt: Date.now(),
          });
          break;

        case 'help':
          addMessage(sessionId, {
            id: crypto.randomUUID(),
            sessionId,
            role: 'system',
            content: (data?.content as string) || 'No help available.',
            createdAt: Date.now(),
          });
          break;

        case 'status': {
          let statusText = '**System Status:**\n\n';
          if (data?.version) statusText += `- **Version:** ${data.version}\n`;
          if (data?.uptime) statusText += `- **Server Uptime:** ${data.uptime}\n`;
          if (data?.model) statusText += `- **Model:** ${data.model}\n`;
          if (data?.provider) statusText += `- **Provider:** ${data.provider}\n`;
          if (data?.nodeVersion) statusText += `- **Node.js:** ${data.nodeVersion}\n`;
          if (data?.platform) statusText += `- **Platform:** ${data.platform}\n`;
          if (data?.projectPath) statusText += `- **Project:** ${data.projectPath}\n`;

          addMessage(sessionId, {
            id: crypto.randomUUID(),
            sessionId,
            role: 'system',
            content: statusText,
            createdAt: Date.now(),
          });
          break;
        }

        case 'cost': {
          const usage = data?.tokenUsage as
            | { used: number; total: number; percentage: string }
            | undefined;
          let costText = '**Token Usage:**\n\n';
          if (usage) {
            costText += `- **Used:** ${usage.used.toLocaleString()} tokens\n`;
            costText += `- **Total:** ${usage.total.toLocaleString()} tokens\n`;
            costText += `- **Usage:** ${usage.percentage}%\n`;
          }
          if (data?.model) {
            costText += `- **Model:** ${data.model}\n`;
          }

          addMessage(sessionId, {
            id: crypto.randomUUID(),
            sessionId,
            role: 'system',
            content: costText,
            createdAt: Date.now(),
          });
          break;
        }

        case 'memory': {
          const memoryData = data as
            | { path?: string; exists?: boolean; message?: string; error?: boolean }
            | undefined;
          addMessage(sessionId, {
            id: crypto.randomUUID(),
            sessionId,
            role: 'system',
            content: memoryData?.message || 'CLAUDE.md information not available.',
            createdAt: Date.now(),
          });
          break;
        }

        case 'model': {
          addMessage(sessionId, {
            id: crypto.randomUUID(),
            sessionId,
            role: 'system',
            content:
              (data?.message as string) ||
              `Model: ${data?.model || 'unknown'}\nProvider: ${data?.provider || 'unknown'}`,
            createdAt: Date.now(),
          });
          break;
        }

        case 'config':
          addMessage(sessionId, {
            id: crypto.randomUUID(),
            sessionId,
            role: 'system',
            content: (data?.message as string) || 'Opening settings...',
            createdAt: Date.now(),
          });
          break;

        case 'new-session':
          addMessage(sessionId, {
            id: crypto.randomUUID(),
            sessionId,
            role: 'system',
            content: (data?.message as string) || 'Creating new session...',
            createdAt: Date.now(),
          });
          break;

        case 'reload':
          // Re-fetch commands from server (cache already cleared server-side)
          (llmProfileId
            ? api.getProviderCommands(llmProfileId, currentProject?.rootPath || undefined)
            : api.getProviderTypeCommands(
                DEFAULT_AGENT_RUNTIME,
                currentProject?.rootPath || undefined
              )
          )
            .then(cmds => {
              useLlmProfileMetaStore.getState().setProviderCommands(commandsCacheKey, cmds);
              addMessage(sessionId, {
                id: crypto.randomUUID(),
                sessionId,
                role: 'system',
                content: `Commands reloaded (${cmds.length} commands)`,
                createdAt: Date.now(),
              });
              setTimeout(() => scrollToBottom(), 100);
            })
            .catch(err => {
              addMessage(sessionId, {
                id: crypto.randomUUID(),
                sessionId,
                role: 'system',
                content: `Failed to reload commands: ${err.message}`,
                createdAt: Date.now(),
              });
            });
          return; // Skip the scrollToBottom below since we handle it in the .then

        case 'show_panel': {
          // Plugin command: activate the panel in its effective placement (bottom or right)
          const panelId = data?.panelId as string | undefined;
          if (panelId && currentProject?.id) {
            setDrawerOpen(currentProject.id, true);
            activatePanel(panelId);
          }
          break;
        }

        default:
          addMessage(sessionId, {
            id: crypto.randomUUID(),
            sessionId,
            role: 'system',
            content: `Command ${cmdName} executed.`,
            createdAt: Date.now(),
          });
      }

      // Scroll to bottom after command output
      setTimeout(() => scrollToBottom(), 100);
    },
    [
      sessionId,
      clearMessages,
      addMessage,
      scrollToBottom,
      llmProfileId,
      currentProject?.rootPath,
      commandsCacheKey,
      currentProject?.id,
      setDrawerOpen,
    ]
  );

  const handleWorktreeChange = useCallback(
    async (worktreePath: string) => {
      if (isForcedPlanSession) {
        throw new Error('Worktree switching is locked during Supervisor planning mode.');
      }
      const previousWorkingDirectory = currentSession?.workingDirectory;
      // Optimistically update projectStore (reflected in the UI immediately)
      useProjectStore.getState().updateSession(sessionId, {
        workingDirectory: worktreePath || undefined,
      });
      // Persist to DB
      try {
        const updatedSession = await api.updateSessionWorkingDirectory(sessionId, worktreePath);
        useProjectStore.getState().updateSession(sessionId, updatedSession);
      } catch (err) {
        console.error('[Worktree] Failed to persist working directory:', err);
        useProjectStore.getState().updateSession(sessionId, {
          workingDirectory: previousWorkingDirectory,
        });
        throw err;
      }
    },
    [currentSession?.workingDirectory, isForcedPlanSession, sessionId]
  );

  const handleResetProviderSession = useCallback(async () => {
    try {
      await api.resetSessionSdkSession(sessionId);
      useSessionConfigStore.getState().clearSessionUsage(sessionId);
      // Clear any stale frontend run state so the session is no longer stuck in loading
      const staleRunId = useRunStore.getState().getSessionRunId(sessionId);
      if (staleRunId) {
        finalizeRunLifecycle(staleRunId);
      }
      useProjectStore.getState().setSessionActive(sessionId, false);
      addMessage(sessionId, {
        id: crypto.randomUUID(),
        sessionId,
        role: 'system',
        content:
          'Underlying CLI session reset. The next message will start a new provider-side session.',
        createdAt: Date.now(),
      });
      setTimeout(() => scrollToBottom(), 100);
    } catch (err) {
      addMessage(sessionId, {
        id: crypto.randomUUID(),
        sessionId,
        role: 'system',
        content: `Failed to reset CLI session: ${(err as Error).message}`,
        createdAt: Date.now(),
      });
      setTimeout(() => scrollToBottom(), 100);
    }
  }, [addMessage, scrollToBottom, sessionId]);

  const handleCommand = useCallback(
    async (command: string, args: string) => {
      // ── URIP §12.4/§17.3: host actions are registered client actions. ──
      // Canonical `/zc:<name>` triggers and the legacy unqualified aliases
      // (/help, /context, /worktree, /goal, /pause, /resume, …) both dispatch
      // through the desktop client action registry; the hard-coded branches
      // are gone. Supervisor-scoped actions fall back to the legacy builtin
      // command flow outside supervisor main sessions, preserving /status.
      const commandDef = commands.find(c => c.command === command);
      let hostActionName = command.startsWith('/zc:')
        ? command.slice(4).toLowerCase()
        : legacyAliasToHostActionName(command);
      if (hostActionName && !hasClientAction(`zc.${hostActionName}`)) {
        hostActionName = undefined;
      }
      const isSupervisorSession = currentSession?.projectRole === 'main' && !!currentProject?.id;
      const SUPERVISOR_ONLY = new Set(['create-task', 'status', 'pause', 'resume']);
      if (hostActionName && SUPERVISOR_ONLY.has(hostActionName) && !isSupervisorSession) {
        hostActionName = undefined;
      }
      if (hostActionName) {
        // MessageInput splits the trigger and argument suffix before calling;
        // both canonical and legacy paths receive the raw args here.
        const actionArgs = args;
        const ctx: ClientActionContext = {
          sessionId,
          args: actionArgs,
          addSystemMessage: (content, metadata) => {
            addMessage(sessionId, {
              id: crypto.randomUUID(),
              sessionId,
              role: 'system',
              content,
              metadata,
              createdAt: Date.now(),
            });
            setTimeout(() => scrollToBottom(), 100);
          },
          services: {
            commands,
            currentSession,
            currentProject,
            isForcedPlanSession,
            switchWorktree: handleWorktreeChange,
          },
        };
        await dispatchClientAction(`zc.${hostActionName}`, ctx);
        return;
      }

      // Provider commands are forwarded to the active agent runtime.
      // Also treat all unrecognized commands (no matching commandDef) as pass-through to Claude,
      // since the input may not be an actual command (e.g. a path like /some/file/path).
      // Plugin commands (source === 'plugin') fall through to api.executeCommand() instead.
      if (commandDef?.source === 'provider' || !commandDef) {
        const commandText = args ? `${command} ${args}` : command;
        const clientMessageId = crypto.randomUUID();
        addMessage(sessionId, {
          id: clientMessageId,
          clientMessageId,
          sessionId,
          role: 'user',
          content: commandText,
          createdAt: Date.now(),
        });

        await startRun({
          type: 'run_start',
          clientRequestId: clientMessageId,
          sessionId,
          input: commandText,
          mode: mode || undefined,
          workingDirectory: currentSession?.workingDirectory || undefined,
        });
        return;
      }

      // Parse args into array
      const argsArray = args.trim() ? args.trim().split(/\s+/) : [];

      // Build context for command execution. `llmProfileId` is already resolved
      // upstream via useProviderCapabilities (which itself goes through
      // useAgentForSession). Fall back to the runtime type `pi` for the
      // local default agent.
      const context = {
        projectPath: currentProject?.rootPath,
        projectName: currentProject?.name,
        sessionId,
        provider: llmProfileId || DEFAULT_AGENT_RUNTIME,
        model: 'default',
      };

      try {
        // First, try to execute via the commands API
        const result = await api.executeCommand({
          commandName: command,
          commandPath: commandDef?.filePath,
          args: argsArray,
          context,
        });

        if (result.type === 'builtin') {
          // Handle built-in command locally
          handleBuiltInCommand(result);
        } else if (result.type === 'custom' && result.content) {
          // Custom command - send processed content to Claude
          const clientMessageId = crypto.randomUUID();
          addMessage(sessionId, {
            id: clientMessageId,
            clientMessageId,
            sessionId,
            role: 'user',
            content: `${command} ${args}`.trim(),
            createdAt: Date.now(),
          });

          await startRun({
            type: 'run_start',
            clientRequestId: clientMessageId,
            sessionId,
            input: result.content,
            mode: mode || undefined,
            workingDirectory: currentSession?.workingDirectory || undefined,
          });
        }
      } catch (error) {
        console.error('Command execution error:', error);

        // Unknown command error
        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: `Failed to execute command: ${error instanceof Error ? error.message : 'Unknown error'}`,
          createdAt: Date.now(),
        });
      }
    },
    [
      sessionId,
      addMessage,
      commands,
      currentSession,
      currentProject,
      handleBuiltInCommand,
      handleWorktreeChange,
      scrollToBottom,
      mode,
      isForcedPlanSession,
      startRun,
      llmProfileId,
    ]
  );

  // Dispatch a host action by canonical name (used by the composer's
  // canonical invocation path for host.action catalog items, §16.3).
  const dispatchHostAction = useCallback(
    async (name: string, actionArgs: string) => {
      if (!hasClientAction(`zc.${name}`)) return;
      const ctx: ClientActionContext = {
        sessionId,
        args: actionArgs,
        addSystemMessage: (content, metadata) => {
          addMessage(sessionId, {
            id: crypto.randomUUID(),
            sessionId,
            role: 'system',
            content,
            metadata,
            createdAt: Date.now(),
          });
          setTimeout(() => scrollToBottom(), 100);
        },
        services: {
          commands,
          currentSession,
          currentProject,
          isForcedPlanSession,
          switchWorktree: handleWorktreeChange,
        },
      };
      await dispatchClientAction(`zc.${name}`, ctx);
    },
    [
      sessionId,
      addMessage,
      scrollToBottom,
      commands,
      currentSession,
      currentProject,
      isForcedPlanSession,
      handleWorktreeChange,
    ]
  );

  // Live context for server-dispatched client actions (invocation_result).
  // Assigned during render: the hook is mounted per open chat session, so the
  // factory always closes over the session that is currently wired.
  setClientActionContextFactory((wireSessionId, wireArgs) => ({
    sessionId: wireSessionId,
    args: wireArgs,
    addSystemMessage: (content, metadata) => {
      addMessage(wireSessionId, {
        id: crypto.randomUUID(),
        sessionId: wireSessionId,
        role: 'system',
        content,
        metadata,
        createdAt: Date.now(),
      });
    },
    services: {
      commands,
      currentSession,
      currentProject,
      isForcedPlanSession,
      switchWorktree: handleWorktreeChange,
    },
  }));

  return {
    handleCommand,
    handleBuiltInCommand,
    handleResetProviderSession,
    handleWorktreeChange,
    dispatchHostAction,
  };
}
