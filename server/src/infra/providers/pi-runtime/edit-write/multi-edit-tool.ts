/**
 * The MultiEdit bridge tool: the explicit form of Edit with an `edits`
 * array, applying two or more exact replacements to one file atomically by
 * delegating to the Edit tool after validating the batch shape.
 */

import type { AgentTool } from '@earendil-works/pi-agent-core';

import { createEditBridgeTool } from './edit-tool.js';
import {
  errorResult,
  parseBatchEdits,
  toolParams,
  type FileMutationTool,
  type FileMutationToolOptions,
  type FileMutationToolUpdate,
} from './shared.js';

export function createMultiEditBridgeTool(
  cwd: string,
  options?: FileMutationToolOptions
): AgentTool {
  const editTool = createEditBridgeTool(cwd, options);
  return {
    ...editTool,
    name: 'MultiEdit',
    label: 'MultiEdit',
    description:
      'Apply two or more exact replacements to one existing workspace file atomically. This is the explicit form of Edit with an `edits` array; it reuses the same read-state, diff, backup, diagnostics, and snapshot behavior.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Workspace-relative path of the file to edit' },
        edits: {
          type: 'array',
          description:
            'Ordered same-file replacements. All replacements apply atomically and consume one mutation attempt.',
          minItems: 2,
          items: {
            type: 'object',
            properties: {
              old_string: { type: 'string' },
              new_string: { type: 'string' },
              replace_all: { type: 'boolean', default: false },
            },
            required: ['old_string', 'new_string'],
          },
        },
        preview_only: { type: 'boolean', default: false },
      },
      required: ['file_path', 'edits'],
    },
    execute: async (
      toolCallId: string,
      params: Parameters<FileMutationTool['execute']>[1],
      signal?: AbortSignal,
      onUpdate?: FileMutationToolUpdate
    ) => {
      const args = toolParams(toolCallId, params);
      const editsResult = parseBatchEdits(args.edits, { toolName: 'MultiEdit', minEdits: 2 });
      if (editsResult?.ok === false) {
        return errorResult(editsResult.code, editsResult.message, editsResult.details ?? {});
      }
      return editTool.execute(toolCallId, params, signal, onUpdate);
    },
  } as unknown as AgentTool;
}
