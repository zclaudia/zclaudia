import type { AgentTool, AgentToolUpdateCallback } from '@earendil-works/pi-agent-core';
import type Database from 'better-sqlite3';
import { existsSync, statSync } from 'fs';
import os from 'os';
import path from 'path';

import { persistSessionSandboxDomain } from '../../../application/conversation/agent/permission-memory.js';
import { TaskRepository } from '../../../domains/tasks/repository.js';
import { TaskService } from '../../../domains/tasks/task-service.js';
import {
  CommandTaskExecutor,
  commandTaskLogPath,
} from '../../../domains/tasks/executors/command-executor.js';
import type { PermissionCallback } from '../types.js';
import {
  findBashFileBypass,
  findBashSensitivePathAccess,
  findBashToolRoutingSuggestion,
  findCriticalBashPattern,
  CRITICAL_BASH_APPROVAL_TOOL,
} from './bash-guards.js';
import {
  killProcessTree,
  persistBashFullOutput,
  runBash,
  type BashRunOptions,
  type BashRunResult,
} from './bash-runner.js';
import { extractBashOutputInsights, formatBashResultText } from './bash-output.js';
import { registerInflightForegroundCommand } from './inflight-bash-registry.js';
import * as sandbox from './sandbox.js';
import {
  networkGrantToAllowedDomain,
  runSandboxedWithEscalation,
  type SandboxGrant,
  type SandboxOperationResult,
  type SandboxPrivilegeMode,
} from './sandbox-execution/index.js';
import { errorResult, textResult, toolParams, truncateText } from './tool-common.js';
import { resolveInsideWorkspace, toWorkspaceRelative } from './workspace-paths.js';

export type SandboxFsDenial = 'read_only' | 'write_outside_workspace';
type AgentToolParameters = AgentTool['parameters'];
type SandboxInvocation = { argv: string[]; env: NodeJS.ProcessEnv };

function agentToolParameters(schema: Record<string, unknown>): AgentToolParameters {
  return schema as AgentToolParameters;
}

function sandboxInvocation(wrap: sandbox.WrapResult): SandboxInvocation | undefined {
  if (!wrap.sandboxed) return undefined;
  if (!wrap.argv || !wrap.env) return undefined;
  return { argv: wrap.argv, env: wrap.env };
}

function parseSandboxMode(value: unknown): SandboxPrivilegeMode {
  return value === 'sandbox' || value === 'unsandboxed' ? value : 'auto';
}

/**
 * Sandbox FS denials surface as kernel-level EPERM ("Operation not permitted")
 * or EROFS ("Read-only file system") in bash stderr — both are macOS
 * sandbox-exec-specific phrasings, so false positives on a normal-Unix Permission
 * denied are avoided. We split the two reasons so the remediation hint can steer
 * the model differently (workspace-relative path vs. ExitPlanMode).
 */
export function detectSandboxFsDenial(
  output: string,
  sandboxed: boolean,
  readOnly: boolean
): SandboxFsDenial | undefined {
  if (!sandboxed) return undefined;
  if (/: Read-only file system\b/.test(output)) return 'read_only';
  if (/: Operation not permitted\b/.test(output)) {
    return readOnly ? 'read_only' : 'write_outside_workspace';
  }
  return undefined;
}

async function persistFullOutputIfTruncated(
  result: Pick<BashRunResult, 'truncated' | 'fullOutput'>
): Promise<string | undefined> {
  if (!result.truncated) return undefined;
  if ('fullOutputPath' in result && typeof result.fullOutputPath === 'string')
    return result.fullOutputPath;
  try {
    return persistBashFullOutput(result.fullOutput);
  } catch {
    return undefined;
  }
}

export interface BashBridgeToolOptions {
  db?: Database.Database;
  sessionId?: string;
  runId?: string;
  permissionCallback?: PermissionCallback;
  sandboxReadOnly?: boolean;
  sandboxAllowedDomains?: string[];
  bashAutoBackgroundMs?: number;
}

export function createBashBridgeTool(cwd: string, options?: BashBridgeToolOptions): AgentTool {
  const DEFAULT_TIMEOUT_SEC = 120;
  const MAX_TIMEOUT_SEC = 600;
  const UPDATE_THROTTLE_MS = 100;
  const DEFAULT_AUTO_BACKGROUND_MS = 60_000;
  const grantedDomains = new Set<string>(options?.sandboxAllowedDomains ?? []);
  return {
    name: 'Bash',
    label: 'Bash',
    description:
      'Execute a shell command (bash -c) in the workspace. Returns merged stdout+stderr and the exit code. Output is truncated to the last 2000 lines / 50KB; full output is written to a temp file when truncated. A command still running after 60s is automatically moved to a background task (returns a taskId to poll with TaskOutput); set an explicit timeout (max 600s) to wait inline and kill at the deadline instead. Set run_in_background:true to background immediately (dev servers, watchers).',
    parameters: agentToolParameters({
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to run' },
        timeout: { type: 'number', description: 'Timeout in seconds (default 120, max 600)' },
        cwd: {
          type: 'string',
          description: 'Workspace-relative working directory (default: workspace root)',
        },
        run_in_background: {
          type: 'boolean',
          default: false,
          description:
            'Run the command as a detached background task. Returns a taskId immediately; poll output with TaskOutput, stop with Monitor. timeout is ignored in background mode.',
        },
        sandbox_mode: {
          type: 'string',
          enum: ['auto', 'sandbox', 'unsandboxed'],
          default: 'auto',
          description:
            'Privilege mode for this call. auto runs sandboxed first and may request least-privilege access; sandbox forbids host execution; unsandboxed requests one-shot host execution and requires privilege_reason.',
        },
        privilege_reason: {
          type: 'string',
          description:
            'Required when sandbox_mode is unsandboxed; explain why host execution is necessary.',
        },
      },
      required: ['command'],
    }),
    execute: async (
      toolCallId: string,
      params: unknown,
      signal?: AbortSignal,
      onUpdate?: AgentToolUpdateCallback
    ) => {
      const args = toolParams(toolCallId, params);
      const command = typeof args.command === 'string' ? args.command : '';
      if (!command.trim()) return errorResult('missing_command', 'Bash requires a command');
      const sandboxMode = parseSandboxMode(args.sandbox_mode);
      const privilegeReason =
        typeof args.privilege_reason === 'string' ? args.privilege_reason.trim() : undefined;

      const critical = findCriticalBashPattern(command);
      if (critical) {
        if (!options?.permissionCallback) {
          return errorResult(
            'critical_command_blocked',
            `Command blocked: it matches a critical-risk pattern (${critical.reason}) and no approval channel is available.`
          );
        }
        const decision = await options.permissionCallback({
          requestId: `${toolCallId}:critical-bash`,
          toolName: CRITICAL_BASH_APPROVAL_TOOL,
          toolInput: { command, reason: critical.reason },
          detail: `This command matches a critical-risk pattern: ${critical.reason}. Approving runs it once.`,
          timeoutSeconds: 0,
          timeoutBehavior: 'deny',
        });
        if (decision.behavior !== 'allow') {
          return errorResult(
            'critical_command_blocked',
            `Command blocked by the user: it matches a critical-risk pattern (${critical.reason}).`
          );
        }
      }

      let runCwd: string;
      try {
        runCwd = resolveInsideWorkspace(cwd, args.cwd);
      } catch (err) {
        return errorResult(
          'path_outside_workspace',
          err instanceof Error ? err.message : String(err)
        );
      }
      if (!existsSync(runCwd)) {
        return errorResult(
          'cwd_not_found',
          `Working directory does not exist: ${toWorkspaceRelative(cwd, runCwd) || '.'}`
        );
      }
      if (!statSync(runCwd).isDirectory()) {
        return errorResult(
          'cwd_not_directory',
          `Working directory is not a directory: ${toWorkspaceRelative(cwd, runCwd) || '.'}`,
          {
            cwd: toWorkspaceRelative(cwd, runCwd) || '.',
          }
        );
      }

      const sensitivePath = findBashSensitivePathAccess(command);
      if (sensitivePath) {
        return errorResult(
          'bash_sensitive_path_blocked',
          `Bash command blocked: ${sensitivePath.reason}. Use dedicated tools for workspace files; sensitive home credentials cannot be read through Bash.`,
          {
            path: sensitivePath.path,
            reason: sensitivePath.reason,
          }
        );
      }

      if (args.run_in_background === true && options?.sandboxReadOnly === true) {
        return errorResult(
          'background_not_allowed_plan_mode',
          'Background commands are not available in plan mode (read-only).'
        );
      }

      let fileBypass = findBashFileBypass(command);
      // A read block only makes sense when the file exists: there is no file
      // state to keep visible for a missing file, and pointing the model at
      // Read would just fail with ENOENT (Bash and Read then bounce the model
      // back and forth). Probe commands like `cat f 2>/dev/null || echo ...`
      // must run and report absence naturally.
      if (fileBypass?.kind === 'file_read' && fileBypass.target) {
        const rawTarget = fileBypass.target.replace(/^~(?=\/|$)/, os.homedir());
        const resolvedTarget = path.isAbsolute(rawTarget)
          ? rawTarget
          : path.resolve(runCwd, rawTarget);
        if (!existsSync(resolvedTarget)) fileBypass = undefined;
      }
      if (fileBypass) {
        const toolName = fileBypass.suggestedTool;
        const message =
          fileBypass.kind === 'file_read'
            ? `Bash file read blocked: ${fileBypass.reason}. Use ${toolName} for workspace source/config files so file state stays visible to the model.`
            : `Bash file mutation blocked: ${fileBypass.reason}. Use ${toolName} for workspace source/config files so diffs, backups, diagnostics, and read-state guards run.`;
        return errorResult(
          fileBypass.kind === 'file_read' ? 'bash_file_read_blocked' : 'bash_file_mutation_blocked',
          message,
          {
            reason: fileBypass.reason,
            suggestedTool: toolName,
            kind: fileBypass.kind,
          }
        );
      }

      const routing = findBashToolRoutingSuggestion(command);
      if (routing) {
        return errorResult(
          'bash_tool_routing_blocked',
          `Bash command blocked: ${routing.reason}. Use ${routing.suggestedTool} with ${JSON.stringify(routing.suggestedInput)} instead so results are structured and visible to tool governance.`,
          {
            reason: routing.reason,
            suggestedTool: routing.suggestedTool,
            suggestedInput: routing.suggestedInput,
            kind: 'tool_routing',
          }
        );
      }

      const sandboxRequired = Boolean(critical);

      if (args.run_in_background === true) {
        const privilegeGate =
          sandboxMode === 'unsandboxed'
            ? await runSandboxedWithEscalation({
                toolCallId,
                toolName: 'Bash',
                sourceText: command,
                allowedDomains: new Set([...sandbox.DEFAULT_ALLOWED_DOMAINS, ...grantedDomains]),
                sandboxMode,
                privilegeReason,
                permissionCallback: options?.permissionCallback,
                operation: async () => ({ ok: true, sandboxed: true, outputText: '' }),
                unsandboxedOperation: async () => ({
                  ok: true,
                  sandboxed: false,
                  outputText: '',
                }),
              })
            : undefined;
        if (privilegeGate && !privilegeGate.result.ok) {
          return textResult(privilegeGate.result.outputText || '(no output)', {
            ok: false,
            ...privilegeGate.details,
            sandboxed: privilegeGate.result.sandboxed,
          });
        }
        const db = options?.db;
        if (!db)
          return errorResult(
            'missing_db_context',
            'Background execution requires database context'
          );
        const repo = new TaskRepository(db);
        const service = new TaskService(repo);
        const executor = new CommandTaskExecutor(repo);
        const task = service.createTask({
          type: 'command',
          sessionId: options?.sessionId,
          runId: options?.runId,
          parentToolUseId: toolCallId,
          title: truncateText(command, 80),
          metadata: {
            command,
            cwd: runCwd,
            workspaceRoot: cwd,
            sandboxAllowedDomains: [...grantedDomains],
            privilegePlan: {
              mode: sandboxMode === 'unsandboxed' ? 'unsandboxed' : 'sandbox',
              grants: [],
            },
            ...(sandboxRequired ? { sandboxRequired: true } : {}),
          },
        });
        try {
          const started = await executor.start(task);
          service.startTask(task.id, { executorRef: started.executorRef });
          const currentTask = repo.findById(task.id);
          const sandboxed = currentTask?.metadata?.sandboxed === true;
          return textResult(
            `Started background task ${task.id}. Poll with TaskOutput({ task_id: "${task.id}" }); stop with Monitor({ action: "stop", task_id: "${task.id}" }).`,
            {
              ok: true,
              background: true,
              taskId: task.id,
              pid: started.executorRef?.pid,
              logPath: commandTaskLogPath(task.id),
              sandboxed,
              ...(privilegeGate?.details ?? {}),
            }
          );
        } catch (err) {
          try {
            service.failTask(task.id, { error: err instanceof Error ? err.message : String(err) });
          } catch {
            /* best-effort */
          }
          return errorResult(
            'background_start_failed',
            err instanceof Error ? err.message : String(err)
          );
        }
      }

      const timeoutSec = Math.min(
        Math.max(1, Number(args.timeout ?? DEFAULT_TIMEOUT_SEC) || DEFAULT_TIMEOUT_SEC),
        MAX_TIMEOUT_SEC
      );
      const canAutoBackground =
        !!options?.db && options?.sandboxReadOnly !== true && args.timeout === undefined;
      const autoBackgroundMs = canAutoBackground
        ? (options?.bashAutoBackgroundMs ?? DEFAULT_AUTO_BACKGROUND_MS) || undefined
        : undefined;

      const canBackgroundConvert = !!options?.db && options?.sandboxReadOnly !== true;
      const manualBackground = canBackgroundConvert ? new AbortController() : undefined;
      const runForegroundBash = async (bashOpts: BashRunOptions) => {
        const unregisterInflight =
          manualBackground && options?.sessionId
            ? registerInflightForegroundCommand({
                sessionId: options.sessionId,
                toolUseId: toolCallId,
                command,
                startedAt: Date.now(),
                requestBackground: () => manualBackground.abort(),
              })
            : undefined;
        try {
          return await runBash({ ...bashOpts, backgroundSignal: manualBackground?.signal });
        } finally {
          unregisterInflight?.();
        }
      };

      let lastEmit = 0;
      const onChunk = onUpdate
        ? (text: string) => {
            const now = Date.now();
            if (now - lastEmit >= UPDATE_THROTTLE_MS) {
              lastEmit = now;
              onUpdate({ content: [{ type: 'text', text }], details: undefined });
            }
          }
        : undefined;

      type BashOperation = SandboxOperationResult & {
        raw?: BashRunResult;
        wrap?: sandbox.WrapResult;
        errorCode?: string;
        errorDetails?: Record<string, unknown>;
      };
      const runOnce = async (
        grants: SandboxGrant[],
        forceUnsandboxed = false
      ): Promise<BashOperation> => {
        const extraAllowedDomains = [
          ...grantedDomains,
          ...grants
            .filter((grant): grant is Extract<SandboxGrant, { type: 'network' }> => grant.type === 'network')
            .map(networkGrantToAllowedDomain),
        ];
        const wrap = forceUnsandboxed
          ? ({ sandboxed: false } as sandbox.WrapResult)
          : await sandbox.wrapCommand(command, {
              workspaceRoot: cwd,
              readOnly: options?.sandboxReadOnly === true,
              extraAllowedDomains,
              signal,
            });
        if (!wrap.sandboxed && options?.sandboxReadOnly === true && !forceUnsandboxed) {
          return {
            ok: false,
            sandboxed: false,
            outputText: 'Read-only Bash requires the sandbox, which is not active for this command',
            exitCode: null,
            errorCode: 'sandbox_unavailable_plan_mode',
          };
        }
        if (!wrap.sandboxed && sandboxRequired && !forceUnsandboxed) {
          return {
            ok: false,
            sandboxed: false,
            outputText:
              'Command requires sandbox isolation because it matched a critical-risk Bash pattern, but the sandbox is unavailable.',
            exitCode: null,
            errorCode: 'sandbox_required_for_critical_command',
            errorDetails: { reason: critical?.reason },
          };
        }
        const sandboxArgs = sandboxInvocation(wrap);
        if (wrap.sandboxed && !sandboxArgs) {
          return {
            ok: false,
            sandboxed: true,
            outputText: 'Sandbox command wrapper did not return argv/env',
            exitCode: null,
            errorCode: 'sandbox_wrap_invalid',
          };
        }
        const raw = await runForegroundBash({
          command,
          cwd: runCwd,
          timeoutSec,
          signal,
          onChunk,
          autoBackgroundMs,
          sandbox: sandboxArgs,
        });
        return {
          ok: raw.exitCode === 0 && !raw.timedOut,
          sandboxed: wrap.sandboxed,
          outputText: raw.fullOutput,
          exitCode: raw.exitCode,
          timedOut: raw.timedOut,
          raw,
          wrap,
        };
      };

      const escalated = await runSandboxedWithEscalation({
        toolCallId,
        toolName: 'Bash',
        sourceText: command,
        allowedDomains: new Set([...sandbox.DEFAULT_ALLOWED_DOMAINS, ...grantedDomains]),
        sandboxMode,
        privilegeReason,
        permissionCallback: options?.permissionCallback,
        operation: grants => runOnce(grants),
        unsandboxedOperation: () => runOnce([], true),
        persistGrant: grant => {
          if (grant.type !== 'network') return;
          const host = networkGrantToAllowedDomain(grant);
          grantedDomains.add(host);
          if (options?.db && options?.sessionId) {
            try {
              persistSessionSandboxDomain(options.db, options.sessionId, host);
            } catch (err) {
              console.warn('[sandbox] failed to persist session network grant; continuing:', err);
            }
          }
        },
      });
      const operationResult = escalated.result as BashOperation;
      if (operationResult.errorCode) {
        return errorResult(
          operationResult.errorCode,
          operationResult.outputText,
          operationResult.errorDetails
        );
      }
      const result = operationResult.raw;
      const wrap = operationResult.wrap ?? ({ sandboxed: operationResult.sandboxed } as sandbox.WrapResult);
      if (!result) {
        return textResult(operationResult.outputText || '(no output)', {
          ok: operationResult.ok,
          ...escalated.details,
          sandboxed: operationResult.sandboxed,
        });
      }

      if (result.handoff) {
        const handoff = result.handoff;
        const db = options?.db;
        if (!db) {
          return errorResult(
            'missing_db_context',
            'Background execution requires database context'
          );
        }
        try {
          const repo = new TaskRepository(db);
          const service = new TaskService(repo);
          const executor = new CommandTaskExecutor(repo);
          const task = service.createTask({
            type: 'command',
            sessionId: options?.sessionId,
            runId: options?.runId,
            parentToolUseId: toolCallId,
            title: truncateText(command, 80),
            metadata: {
              command,
              cwd: runCwd,
              workspaceRoot: cwd,
              autoBackgrounded: true,
              sandboxAllowedDomains: [...grantedDomains],
              sandboxed: wrap.sandboxed,
              privilegePlan: {
                mode: escalated.details.privilegeMode === 'unsandboxed' ? 'unsandboxed' : 'sandbox',
                grants: escalated.details.grantsUsed ?? [],
              },
              ...(sandboxRequired ? { sandboxRequired: true } : {}),
            },
          });
          handoff.detach();
          const adopted = executor.adopt(
            task,
            handoff.child,
            result.fullOutput,
            result.fullOutputPath
          );
          service.startTask(task.id, { executorRef: adopted.executorRef });
          const reason = manualBackground?.signal.aborted
            ? "Moved to background at the user's request"
            : `Still running after ${Math.round((autoBackgroundMs ?? 0) / 1000)}s - moved to background`;
          const tail = result.output ? `${result.output}\n\n` : '';
          return textResult(
            `${tail}[${reason} as task ${task.id}. ` +
              `Poll with TaskOutput({ task_id: "${task.id}" }); stop with Monitor({ action: "stop", task_id: "${task.id}" }).]`,
            {
              ok: true,
              background: true,
              autoBackgrounded: true,
              taskId: task.id,
              pid: handoff.child.pid,
              logPath: commandTaskLogPath(task.id),
              durationMs: result.durationMs,
              ...escalated.details,
              sandboxed: wrap.sandboxed,
            }
          );
        } catch (err) {
          if (handoff.child.pid) killProcessTree(handoff.child.pid);
          return errorResult(
            'auto_background_failed',
            err instanceof Error ? err.message : String(err)
          );
        }
      }

      if (result.aborted) {
        const fullOutputPath = await persistFullOutputIfTruncated(result);
        const insights = extractBashOutputInsights(result.fullOutput);
        const text = formatBashResultText(
          {
            command,
            cwd: toWorkspaceRelative(cwd, runCwd) || '.',
            output: result.output,
            fullOutput: result.fullOutput,
            exitCode: null,
            durationMs: result.durationMs,
            truncated: result.truncated,
            timedOut: false,
            sandboxed: wrap.sandboxed,
            ...(fullOutputPath ? { fullOutputPath } : {}),
            aborted: true,
          },
          insights
        );
        return textResult(text, {
          ok: false,
          aborted: true,
          exitCode: null,
          truncated: result.truncated,
          durationMs: result.durationMs,
          ...escalated.details,
          sandboxed: wrap.sandboxed,
          ...(fullOutputPath ? { fullOutputPath } : {}),
          ...(insights.diagnostics.length ? { diagnostics: insights.diagnostics } : {}),
          ...(insights.failedTests.length ? { failedTests: insights.failedTests } : {}),
        });
      }

      const fullOutputPath = await persistFullOutputIfTruncated(result);
      const insights = extractBashOutputInsights(result.fullOutput);
      const text = formatBashResultText(
        {
          command,
          cwd: toWorkspaceRelative(cwd, runCwd) || '.',
          output: result.output,
          fullOutput: result.fullOutput,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          truncated: result.truncated,
          timedOut: result.timedOut,
          sandboxed: wrap.sandboxed,
          ...(fullOutputPath ? { fullOutputPath } : {}),
        },
        insights
      );

      const sandboxFsDenied =
        result.exitCode !== 0 && !result.timedOut
          ? detectSandboxFsDenial(
              result.fullOutput,
              wrap.sandboxed,
              options?.sandboxReadOnly === true
            )
          : undefined;

      return textResult(text, {
        ok: result.exitCode === 0 && !result.timedOut,
        exitCode: result.exitCode,
        truncated: result.truncated,
        timedOut: result.timedOut,
        ...(fullOutputPath ? { fullOutputPath } : {}),
        durationMs: result.durationMs,
        ...escalated.details,
        sandboxed: wrap.sandboxed,
        ...(insights.diagnostics.length ? { diagnostics: insights.diagnostics } : {}),
        ...(insights.failedTests.length ? { failedTests: insights.failedTests } : {}),
        ...(sandboxFsDenied ? { sandboxFsDenied } : {}),
      });
    },
  };
}
