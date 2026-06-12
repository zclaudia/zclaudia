import type { AgentTool } from '@earendil-works/pi-agent-core';
import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { writeFile } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { persistSessionSandboxDomain } from '../../../application/conversation/agent/permission-memory.js';
import { TaskRepository } from '../../../domains/tasks/repository.js';
import { TaskService } from '../../../domains/tasks/task-service.js';
import { CommandTaskExecutor, commandTaskLogPath } from '../../../domains/tasks/executors/command-executor.js';
import type { PermissionCallback } from '../types.js';
import { findCriticalBashPattern, CRITICAL_BASH_APPROVAL_TOOL } from './bash-guards.js';
import { killProcessTree, runBash, type BashRunOptions } from './bash-runner.js';
import { registerInflightForegroundCommand } from './inflight-bash-registry.js';
import * as sandbox from './sandbox.js';
import { detectSandboxDenial, MAX_ESCALATION_ITERATIONS, SANDBOX_NETWORK_ESCALATION_TOOL } from './sandbox-denial.js';
import { errorResult, textResult, toolParams, truncateText } from './tool-common.js';
import { resolveInsideWorkspace, toWorkspaceRelative } from './workspace-paths.js';

export type SandboxFsDenial = 'read_only' | 'write_outside_workspace';

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
  readOnly: boolean,
): SandboxFsDenial | undefined {
  if (!sandboxed) return undefined;
  if (/: Read-only file system\b/.test(output)) return 'read_only';
  if (/: Operation not permitted\b/.test(output)) {
    return readOnly ? 'read_only' : 'write_outside_workspace';
  }
  return undefined;
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

export function createBashBridgeTool(cwd: string, options?: BashBridgeToolOptions): AgentTool<any> {
  const DEFAULT_TIMEOUT_SEC = 120;
  const MAX_TIMEOUT_SEC = 600;
  const UPDATE_THROTTLE_MS = 100;
  const DEFAULT_AUTO_BACKGROUND_MS = 60_000;
  const grantedDomains = new Set<string>(options?.sandboxAllowedDomains ?? []);
  const buildEscalationDetail = (hosts: string[]): string => {
    const plural = hosts.length > 1;
    return `This command tried to reach ${plural ? 'domains' : 'a domain'} not on the network allow-list: ${hosts.join(', ')}. `
      + `Approving allows ${plural ? 'them' : 'it'} for this session and re-runs the entire command - make sure the command is safe to repeat.`;
  };
  return {
    name: 'Bash',
    label: 'Bash',
    description: 'Execute a shell command (bash -c) in the workspace. Returns merged stdout+stderr and the exit code. Output is truncated to the last 2000 lines / 50KB; full output is written to a temp file when truncated. A command still running after 60s is automatically moved to a background task (returns a taskId to poll with TaskOutput); set an explicit timeout (max 600s) to wait inline and kill at the deadline instead. Set run_in_background:true to background immediately (dev servers, watchers).',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to run' },
        timeout: { type: 'number', description: 'Timeout in seconds (default 120, max 600)' },
        cwd: { type: 'string', description: 'Workspace-relative working directory (default: workspace root)' },
        run_in_background: { type: 'boolean', default: false, description: 'Run the command as a detached background task. Returns a taskId immediately; poll output with TaskOutput, stop with Monitor. timeout is ignored in background mode.' },
      },
      required: ['command'],
    } as any,
    execute: async (toolCallId: string, params: unknown, signal?: AbortSignal, onUpdate?: (p: unknown) => void) => {
      const args = toolParams(toolCallId, params);
      const command = typeof args.command === 'string' ? args.command : '';
      if (!command.trim()) return errorResult('missing_command', 'Bash requires a command');

      const critical = findCriticalBashPattern(command);
      if (critical) {
        if (!options?.permissionCallback) {
          return errorResult(
            'critical_command_blocked',
            `Command blocked: it matches a critical-risk pattern (${critical.reason}) and no approval channel is available.`,
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
            `Command blocked by the user: it matches a critical-risk pattern (${critical.reason}).`,
          );
        }
      }

      let runCwd: string;
      try {
        runCwd = resolveInsideWorkspace(cwd, args.cwd);
      } catch (err) {
        return errorResult('path_outside_workspace', err instanceof Error ? err.message : String(err));
      }
      if (!existsSync(runCwd)) {
        return errorResult('cwd_not_found', `Working directory does not exist: ${toWorkspaceRelative(cwd, runCwd) || '.'}`);
      }

      if (args.run_in_background === true) {
        if (options?.sandboxReadOnly === true) {
          return errorResult('background_not_allowed_plan_mode', 'Background commands are not available in plan mode (read-only).');
        }
        const db = options?.db;
        if (!db) return errorResult('missing_db_context', 'Background execution requires database context');
        const repo = new TaskRepository(db);
        const service = new TaskService(repo);
        const executor = new CommandTaskExecutor(repo);
        const task = service.createTask({
          type: 'command',
          sessionId: options?.sessionId,
          runId: options?.runId,
          parentToolUseId: toolCallId,
          title: truncateText(command, 80),
          metadata: { command, cwd: runCwd },
        });
        try {
          const started = await executor.start(task);
          service.startTask(task.id, { executorRef: started.executorRef });
          return textResult(
            `Started background task ${task.id}. Poll with TaskOutput({ task_id: "${task.id}" }); stop with Monitor({ action: "stop", task_id: "${task.id}" }).`,
            { ok: true, background: true, taskId: task.id, pid: started.executorRef?.pid, logPath: commandTaskLogPath(task.id) },
          );
        } catch (err) {
          try { service.failTask(task.id, { error: err instanceof Error ? err.message : String(err) }); } catch { /* best-effort */ }
          return errorResult('background_start_failed', err instanceof Error ? err.message : String(err));
        }
      }

      const timeoutSec = Math.min(Math.max(1, Number(args.timeout ?? DEFAULT_TIMEOUT_SEC) || DEFAULT_TIMEOUT_SEC), MAX_TIMEOUT_SEC);
      const canAutoBackground = !!options?.db
        && options?.sandboxReadOnly !== true
        && args.timeout === undefined;
      const autoBackgroundMs = canAutoBackground
        ? ((options?.bashAutoBackgroundMs ?? DEFAULT_AUTO_BACKGROUND_MS) || undefined)
        : undefined;

      const canBackgroundConvert = !!options?.db && options?.sandboxReadOnly !== true;
      const manualBackground = canBackgroundConvert ? new AbortController() : undefined;
      const runForegroundBash = async (bashOpts: BashRunOptions) => {
        const unregisterInflight = manualBackground && options?.sessionId
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

      let wrap = await sandbox.wrapCommand(command, {
        workspaceRoot: cwd,
        readOnly: options?.sandboxReadOnly === true,
        extraAllowedDomains: [...grantedDomains],
        signal,
      });
      if (!wrap.sandboxed && options?.sandboxReadOnly === true) {
        return errorResult('sandbox_unavailable_plan_mode', 'Read-only Bash requires the sandbox, which is not active for this command');
      }
      let result = await runForegroundBash({
        command, cwd: runCwd, timeoutSec, signal, onChunk, autoBackgroundMs,
        sandbox: wrap.sandboxed ? { argv: wrap.argv!, env: wrap.env! } : undefined,
      });

      const canEscalate = wrap.sandboxed && options?.sandboxReadOnly !== true && !!options?.permissionCallback;
      for (let iteration = 0; canEscalate && iteration < MAX_ESCALATION_ITERATIONS; iteration++) {
        if (result.handoff || result.aborted || result.exitCode === 0) break;
        const allowedNow = new Set<string>([...sandbox.DEFAULT_ALLOWED_DOMAINS, ...grantedDomains]);
        const denial = detectSandboxDenial(command, result.fullOutput, allowedNow);
        if (!denial) break;
        const decision = await options!.permissionCallback!({
          requestId: `${toolCallId}:sandbox-net:${iteration}`,
          toolName: SANDBOX_NETWORK_ESCALATION_TOOL,
          toolInput: { command, hosts: denial.hosts },
          detail: buildEscalationDetail(denial.hosts),
          timeoutSeconds: 0,
          timeoutBehavior: 'deny',
        });
        if (decision.behavior !== 'allow') break;
        for (const host of denial.hosts) {
          grantedDomains.add(host);
          if (options?.db && options?.sessionId) {
            try {
              persistSessionSandboxDomain(options.db, options.sessionId, host);
            } catch (err) {
              console.warn('[sandbox] failed to persist session network grant; continuing:', err);
            }
          }
        }
        wrap = await sandbox.wrapCommand(command, {
          workspaceRoot: cwd,
          readOnly: options?.sandboxReadOnly === true,
          extraAllowedDomains: [...grantedDomains],
          signal,
        });
        if (!wrap.sandboxed) break;
        result = await runForegroundBash({
          command, cwd: runCwd, timeoutSec, signal, onChunk, autoBackgroundMs,
          sandbox: { argv: wrap.argv!, env: wrap.env! },
        });
      }

      if (result.handoff) {
        const handoff = result.handoff;
        try {
          const repo = new TaskRepository(options!.db!);
          const service = new TaskService(repo);
          const executor = new CommandTaskExecutor(repo);
          const task = service.createTask({
            type: 'command',
            sessionId: options?.sessionId,
            runId: options?.runId,
            parentToolUseId: toolCallId,
            title: truncateText(command, 80),
            metadata: { command, cwd: runCwd, autoBackgrounded: true },
          });
          handoff.detach();
          const adopted = executor.adopt(task, handoff.child, result.fullOutput);
          service.startTask(task.id, { executorRef: adopted.executorRef });
          const reason = manualBackground?.signal.aborted
            ? 'Moved to background at the user\'s request'
            : `Still running after ${Math.round((autoBackgroundMs ?? 0) / 1000)}s - moved to background`;
          const tail = result.output ? `${result.output}\n\n` : '';
          return textResult(
            `${tail}[${reason} as task ${task.id}. `
              + `Poll with TaskOutput({ task_id: "${task.id}" }); stop with Monitor({ action: "stop", task_id: "${task.id}" }).]`,
            {
              ok: true,
              background: true,
              autoBackgrounded: true,
              taskId: task.id,
              pid: handoff.child.pid,
              logPath: commandTaskLogPath(task.id),
              durationMs: result.durationMs,
              sandboxed: wrap.sandboxed,
            },
          );
        } catch (err) {
          if (handoff.child.pid) killProcessTree(handoff.child.pid);
          return errorResult('auto_background_failed', err instanceof Error ? err.message : String(err));
        }
      }

      if (result.aborted) {
        return textResult(result.output || '', { ok: false, aborted: true, exitCode: null });
      }

      let fullOutputPath: string | undefined;
      if (result.truncated) {
        const candidate = path.join(os.tmpdir(), `zclaudia-bash-${randomUUID()}.log`);
        try { await writeFile(candidate, result.fullOutput, 'utf8'); fullOutputPath = candidate; }
        catch { fullOutputPath = undefined; }
      }

      const footers: string[] = [];
      if (result.truncated && fullOutputPath) footers.push(`Output truncated (showing tail). Full output: ${fullOutputPath}`);
      if (result.timedOut) footers.push(`Command timed out after ${timeoutSec} seconds`);
      else if (result.exitCode !== 0 && result.exitCode !== null) footers.push(`Exit code: ${result.exitCode}`);

      let text = result.output;
      if (footers.length) text = `${text ? text + '\n\n' : ''}[${footers.join('. ')}]`;
      if (!text) text = '(no output)';

      const sandboxFsDenied = result.exitCode !== 0 && !result.timedOut
        ? detectSandboxFsDenial(result.fullOutput, wrap.sandboxed, options?.sandboxReadOnly === true)
        : undefined;

      return textResult(text, {
        ok: result.exitCode === 0 && !result.timedOut,
        exitCode: result.exitCode,
        truncated: result.truncated,
        timedOut: result.timedOut,
        ...(fullOutputPath ? { fullOutputPath } : {}),
        durationMs: result.durationMs,
        sandboxed: wrap.sandboxed,
        ...(sandboxFsDenied ? { sandboxFsDenied } : {}),
      });
    },
  } as unknown as AgentTool<any>;
}
