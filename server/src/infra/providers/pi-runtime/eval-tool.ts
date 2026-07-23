import type { AgentTool } from '@earendil-works/pi-agent-core';
import type Database from 'better-sqlite3';

import { persistSessionSandboxDomain } from '../../../application/conversation/agent/permission-memory.js';
import { TaskRepository } from '../../../domains/tasks/repository.js';
import { TaskService } from '../../../domains/tasks/task-service.js';
import type { PermissionCallback } from '../types.js';
import { getEvalKernel, runOneShotEval, type EvalExecResult } from './eval-kernel.js';
import { EvalTaskRuntime } from './eval-task-runtime.js';
import { findBashSensitivePathAccess } from './bash-guards.js';
import * as sandbox from './sandbox.js';
import {
  networkGrantToAllowedDomain,
  runSandboxedWithEscalation,
  type SandboxGrant,
  type SandboxOperationResult,
  type SandboxPrivilegeMode,
} from './sandbox-execution/index.js';
import { errorResult, textResult, toolParams } from './tool-common.js';

export interface EvalBridgeToolOptions {
  sessionId?: string;
  runId?: string;
  db?: Database.Database;
  sandboxReadOnly?: boolean;
  sandboxAllowedDomains?: string[];
  permissionCallback?: PermissionCallback;
}

function parseEvalTimeout(
  value: unknown
):
  | { ok: true; timeoutMs?: number }
  | { ok: false; message: string; details: Record<string, unknown> } {
  if (value === undefined) return { ok: true };
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    return {
      ok: false,
      message: 'Eval timeout must be an integer number of seconds',
      details: { value },
    };
  }
  if (value < 1 || value > 600) {
    return {
      ok: false,
      message: 'Eval timeout must be between 1 and 600 seconds',
      details: { value, min: 1, max: 600 },
    };
  }
  return { ok: true, timeoutMs: value * 1000 };
}

function parseSandboxMode(value: unknown): SandboxPrivilegeMode {
  return value === 'sandbox' || value === 'unsandboxed' ? value : 'auto';
}

function formatEvalResultText(result: EvalExecResult): string {
  let text = result.output || '';
  if (result.error) text = text ? `${text}\n${result.error}` : result.error;
  if (result.outputTruncated && result.fullOutputPath) {
    text = `${text}\n... [eval output truncated; full output: ${result.fullOutputPath}]`;
  }
  return text || '(no output)';
}

// Per-session history of the privilege key each Eval kernel base last ran with.
// A new network grant changes the privilege key, so the next cell silently
// spawns a FRESH kernel and all in-memory state vanishes; tracking the previous
// key lets the tool surface that restart as kernelRestarted/'grants_changed'
// instead of dropping state with no signal.
const lastPrivilegeKeyByKernelBase = new Map<string, string>();

export function __resetEvalPrivilegeKeyHistoryForTests(): void {
  lastPrivilegeKeyByKernelBase.clear();
}

export function createEvalBridgeTool(cwd: string, options?: EvalBridgeToolOptions): AgentTool<any> {
  return {
    name: 'Eval',
    label: 'Eval',
    description:
      'Run JavaScript in a persistent per-session Node kernel. Best for arithmetic, parsing already-structured data (JSON in scope, numbers, dates), and transforms over values that live in kernel state from earlier cells. var/function/const declarations persist between cells. Cells containing `await` run in an async wrapper: use `return` for the result value and globalThis.x for cross-cell persistence. console output is captured. Runs under the same sandbox policy as Bash. Set reset:true to start a fresh kernel. Do NOT paste raw search/grep output into the code as string literals to filter it — unescaped quotes break parsing; pipe through Bash/Grep with the right flags (or write a small Bash one-liner) instead.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JavaScript code to evaluate' },
        timeout: {
          type: 'number',
          description:
            'Per-cell timeout in seconds (default 30, max 600). On timeout the kernel restarts and state is lost.',
        },
        reset: {
          type: 'boolean',
          default: false,
          description: 'Discard kernel state before running',
        },
        run_in_background: {
          type: 'boolean',
          default: false,
          description:
            'Run this code as an isolated one-shot background task. Does not use or mutate the persistent Eval kernel.',
        },
        sandbox_mode: {
          type: 'string',
          enum: ['auto', 'sandbox', 'unsandboxed'],
          default: 'auto',
          description:
            'Sandbox privilege mode. auto retries only confirmed sandbox capability denials with permission; sandbox never escalates; unsandboxed requires privilege_reason and explicit approval.',
        },
        privilege_reason: {
          type: 'string',
          description:
            'Required when sandbox_mode is unsandboxed; explain why the sandbox cannot be used.',
        },
      },
      required: ['code'],
    } as any,
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      if (typeof args.code !== 'string' || !args.code.trim()) {
        return errorResult('missing_code', 'Eval requires code');
      }
      const code = args.code;
      const timeout = parseEvalTimeout(args.timeout);
      if (!timeout.ok) {
        return errorResult('invalid_timeout', timeout.message, timeout.details);
      }
      const sandboxMode = parseSandboxMode(args.sandbox_mode);
      const privilegeReason =
        typeof args.privilege_reason === 'string' ? args.privilege_reason : undefined;
      const sensitivePath = findBashSensitivePathAccess(code);
      if (sensitivePath) {
        return errorResult(
          'eval_sensitive_path_blocked',
          `Eval code blocked: ${sensitivePath.reason}. Sensitive home credentials cannot be read through Eval.`,
          {
            path: sensitivePath.path,
            reason: sensitivePath.reason,
          }
        );
      }
      if (args.run_in_background === true) {
        const privilegeGate =
          sandboxMode === 'unsandboxed'
            ? await runSandboxedWithEscalation({
                toolCallId,
                toolName: 'Eval',
                sourceText: code,
                allowedDomains: new Set([
                  ...sandbox.DEFAULT_ALLOWED_DOMAINS,
                  ...(options?.sandboxAllowedDomains ?? []),
                ]),
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
        if (!options?.db)
          return errorResult(
            'missing_db_context',
            'Eval background execution requires database context'
          );
        const repo = new TaskRepository(options.db);
        const service = new TaskService(repo);
        const task = service.createTask({
          type: 'eval',
          title: 'Eval background task',
          sessionId: options.sessionId,
          runId: options.runId,
          parentSessionId: options.sessionId,
          parentRunId: options.runId,
          parentToolUseId: typeof toolCallId === 'string' ? toolCallId : undefined,
          metadata: {
            code,
            workspaceRoot: cwd,
            readOnly: options.sandboxReadOnly === true,
            ...(timeout.timeoutMs !== undefined ? { timeoutMs: timeout.timeoutMs } : {}),
            privilegePlan: {
              mode: sandboxMode === 'unsandboxed' ? 'unsandboxed' : 'sandbox',
              // Carry session-granted network domains into the task so the
              // isolated background eval gets the same allow-list as the
              // foreground kernel (they were silently dropped before).
              grants: (options?.sandboxAllowedDomains ?? []).map(host => ({
                type: 'network' as const,
                host,
              })),
            },
          },
        });
        try {
          const runtime = new EvalTaskRuntime(repo);
          const runningTask = service.startTask(task.id);
          const started = await runtime.start(runningTask);
          const running = repo.update(task.id, { executorRef: started.executorRef });
          return textResult(`Started Eval background task ${running.id}`, {
            ok: true,
            taskId: running.id,
            status: running.status,
            type: 'eval',
            ...(privilegeGate?.details ?? {}),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          service.failTask(task.id, { error: message });
          return errorResult('eval_background_start_failed', message, { taskId: task.id });
        }
      }
      const readOnly = options?.sandboxReadOnly === true;
      const grantedDomains = new Set(options?.sandboxAllowedDomains ?? []);
      type EvalOperation = SandboxOperationResult & { evalResult?: EvalExecResult };
      const runEval = async (
        grants: SandboxGrant[],
        forceUnsandboxed = false
      ): Promise<EvalOperation> => {
        const extraAllowedDomains = [
          ...grantedDomains,
          ...grants
            .filter(
              (grant): grant is Extract<SandboxGrant, { type: 'network' }> =>
                grant.type === 'network'
            )
            .map(networkGrantToAllowedDomain),
        ];
        const privilegeKey = forceUnsandboxed
          ? 'unsandboxed'
          : extraAllowedDomains.length > 0
            ? `sandbox:${extraAllowedDomains.sort().join(',')}`
            : 'sandbox';
        const kernelBaseKey = `${options?.sessionId ?? `cwd:${cwd}`}:${readOnly ? 'ro' : 'rw'}`;
        const kernelKey = `${kernelBaseKey}:${privilegeKey}`;
        const previousPrivilegeKey = lastPrivilegeKeyByKernelBase.get(kernelBaseKey);
        lastPrivilegeKeyByKernelBase.set(kernelBaseKey, privilegeKey);
        const kernelRestartedByGrants =
          previousPrivilegeKey !== undefined && previousPrivilegeKey !== privilegeKey;
        const evalOptions = {
          workspaceRoot: cwd,
          readOnly,
          extraAllowedDomains,
          unsandboxed: forceUnsandboxed,
        };
        const result =
          forceUnsandboxed && args.reset === true
            ? await runOneShotEval(evalOptions, code, {
                ...(timeout.timeoutMs !== undefined ? { timeoutMs: timeout.timeoutMs } : {}),
              })
            : await getEvalKernel(kernelKey, evalOptions).exec(code, {
                ...(timeout.timeoutMs !== undefined ? { timeoutMs: timeout.timeoutMs } : {}),
                reset: args.reset === true,
              });
        // The privilege key changed since the previous cell, so this cell ran
        // in a fresh kernel and prior var/function state is gone. An explicit
        // reset already signals the wipe; a kernel-reported restart (timeout,
        // exit) carries its own signal — don't mask either.
        if (kernelRestartedByGrants && args.reset !== true && !result.kernelRestarted) {
          result.kernelRestarted = true;
          result.kernelRestartReason = 'grants_changed';
        }
        return {
          ok: result.ok,
          sandboxed: result.sandboxed !== false,
          outputText: formatEvalResultText(result),
          timedOut: result.timedOut,
          evalResult: result,
        };
      };
      const escalated = await runSandboxedWithEscalation({
        toolCallId,
        toolName: 'Eval',
        sourceText: code,
        allowedDomains: new Set([...sandbox.DEFAULT_ALLOWED_DOMAINS, ...grantedDomains]),
        sandboxMode,
        privilegeReason,
        permissionCallback: options?.permissionCallback,
        operation: grants => runEval(grants),
        unsandboxedOperation: () => runEval([], true),
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
      const operationResult = escalated.result as EvalOperation;
      const result = operationResult.evalResult;
      if (!result) {
        return textResult(operationResult.outputText || '(no output)', {
          ok: operationResult.ok,
          ...escalated.details,
          sandboxed: operationResult.sandboxed,
        });
      }
      return textResult(operationResult.outputText, {
        ok: result.ok,
        ...(result.timedOut ? { timedOut: true } : {}),
        ...(result.kernelRestarted ? { kernelRestarted: true } : {}),
        ...(result.kernelRestartReason ? { kernelRestartReason: result.kernelRestartReason } : {}),
        ...(result.sandboxed !== undefined ? { sandboxed: result.sandboxed } : {}),
        ...(result.outputTruncated ? { outputTruncated: true } : {}),
        ...(result.fullOutputPath ? { fullOutputPath: result.fullOutputPath } : {}),
        ...escalated.details,
      });
    },
  } as unknown as AgentTool<any>;
}
