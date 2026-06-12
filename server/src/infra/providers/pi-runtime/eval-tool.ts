import type { AgentTool } from '@earendil-works/pi-agent-core';

import { getEvalKernel } from './eval-kernel.js';
import { errorResult, textResult, toolParams } from './tool-common.js';

export interface EvalBridgeToolOptions {
  sessionId?: string;
  sandboxReadOnly?: boolean;
}

export function createEvalBridgeTool(cwd: string, options?: EvalBridgeToolOptions): AgentTool<any> {
  return {
    name: 'Eval',
    label: 'Eval',
    description: 'Run JavaScript in a persistent per-session Node kernel (much faster than Bash for data processing - state survives across calls). var/function/const declarations persist between cells. Cells containing `await` run in an async wrapper: use `return` for the result value and globalThis.x for cross-cell persistence. console output is captured. Runs under the same sandbox policy as Bash. Set reset:true to start a fresh kernel.',
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
      const readOnly = options?.sandboxReadOnly === true;
      const kernelKey = `${options?.sessionId ?? `cwd:${cwd}`}:${readOnly ? 'ro' : 'rw'}`;
      const kernel = getEvalKernel(kernelKey, { workspaceRoot: cwd, readOnly });
      const timeoutMs = typeof args.timeout === 'number' && Number.isFinite(args.timeout)
        ? args.timeout * 1000
        : undefined;
      const result = await kernel.exec(args.code, {
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        reset: args.reset === true,
      });
      let text = result.output || '';
      if (result.error) text = text ? `${text}\n${result.error}` : result.error;
      if (!text) text = '(no output)';
      return textResult(text, {
        ok: result.ok,
        ...(result.timedOut ? { timedOut: true } : {}),
        ...(result.kernelRestarted ? { kernelRestarted: true } : {}),
        ...(result.sandboxed !== undefined ? { sandboxed: result.sandboxed } : {}),
      });
    },
  } as unknown as AgentTool<any>;
}
