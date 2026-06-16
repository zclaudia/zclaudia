import type { AgentTool } from '@earendil-works/pi-agent-core';

import { getEvalKernel } from './eval-kernel.js';
import { findBashSensitivePathAccess } from './bash-guards.js';
import { errorResult, textResult, toolParams } from './tool-common.js';

export interface EvalBridgeToolOptions {
  sessionId?: string;
  sandboxReadOnly?: boolean;
}

function parseEvalTimeout(value: unknown): { ok: true; timeoutMs?: number } | { ok: false; message: string; details: Record<string, unknown> } {
  if (value === undefined) return { ok: true };
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    return { ok: false, message: 'Eval timeout must be an integer number of seconds', details: { value } };
  }
  if (value < 1 || value > 600) {
    return { ok: false, message: 'Eval timeout must be between 1 and 600 seconds', details: { value, min: 1, max: 600 } };
  }
  return { ok: true, timeoutMs: value * 1000 };
}

export function createEvalBridgeTool(cwd: string, options?: EvalBridgeToolOptions): AgentTool<any> {
  return {
    name: 'Eval',
    label: 'Eval',
    description: 'Run JavaScript in a persistent per-session Node kernel. Best for arithmetic, parsing already-structured data (JSON in scope, numbers, dates), and transforms over values that live in kernel state from earlier cells. var/function/const declarations persist between cells. Cells containing `await` run in an async wrapper: use `return` for the result value and globalThis.x for cross-cell persistence. console output is captured. Runs under the same sandbox policy as Bash. Set reset:true to start a fresh kernel. Do NOT paste raw search/grep output into the code as string literals to filter it — unescaped quotes break parsing; pipe through Bash/Grep with the right flags (or write a small Bash one-liner) instead.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JavaScript code to evaluate' },
        timeout: { type: 'number', description: 'Per-cell timeout in seconds (default 30, max 600). On timeout the kernel restarts and state is lost.' },
        reset: { type: 'boolean', default: false, description: 'Discard kernel state before running' },
      },
      required: ['code'],
    } as any,
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      if (typeof args.code !== 'string' || !args.code.trim()) {
        return errorResult('missing_code', 'Eval requires code');
      }
      const timeout = parseEvalTimeout(args.timeout);
      if (!timeout.ok) {
        return errorResult('invalid_timeout', timeout.message, timeout.details);
      }
      const sensitivePath = findBashSensitivePathAccess(args.code);
      if (sensitivePath) {
        return errorResult(
          'eval_sensitive_path_blocked',
          `Eval code blocked: ${sensitivePath.reason}. Sensitive home credentials cannot be read through Eval.`,
          {
            path: sensitivePath.path,
            reason: sensitivePath.reason,
          },
        );
      }
      const readOnly = options?.sandboxReadOnly === true;
      const kernelKey = `${options?.sessionId ?? `cwd:${cwd}`}:${readOnly ? 'ro' : 'rw'}`;
      const kernel = getEvalKernel(kernelKey, { workspaceRoot: cwd, readOnly });
      const result = await kernel.exec(args.code, {
        ...(timeout.timeoutMs !== undefined ? { timeoutMs: timeout.timeoutMs } : {}),
        reset: args.reset === true,
      });
      let text = result.output || '';
      if (result.error) text = text ? `${text}\n${result.error}` : result.error;
      if (result.outputTruncated && result.fullOutputPath) {
        text = `${text}\n... [eval output truncated; full output: ${result.fullOutputPath}]`;
      }
      if (!text) text = '(no output)';
      return textResult(text, {
        ok: result.ok,
        ...(result.timedOut ? { timedOut: true } : {}),
        ...(result.kernelRestarted ? { kernelRestarted: true } : {}),
        ...(result.sandboxed !== undefined ? { sandboxed: result.sandboxed } : {}),
        ...(result.outputTruncated ? { outputTruncated: true } : {}),
        ...(result.fullOutputPath ? { fullOutputPath: result.fullOutputPath } : {}),
      });
    },
  } as unknown as AgentTool<any>;
}
