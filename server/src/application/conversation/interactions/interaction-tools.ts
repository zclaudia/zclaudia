/**
 * Internal Interaction Tools
 *
 * Registers zclaudia's own interaction tools in the tool registry.
 * These tools are injected into providers via the MCP bridge and allow
 * the AI to produce structured interaction events.
 *
 * - update_todo_list: fire-and-forget, emits interaction_todo_update
 * - ask_user_form: blocks until user responds, emits interaction_prompt
 * - request_approval: blocks until user approves/rejects
 * - push_file: fire-and-forget, pushes a local file to user's device
 */

import { newId } from '../../../utils/uuid.js';
import http from 'http';
import { toolRegistry } from '../../../application/plugins/index.js';
import { interactionDispatcher } from './interaction-dispatcher.js';
import { MAX_TODO_CONTENT_CHARS, MAX_TODO_ITEMS, validateTodoItems } from './todo-normalizer.js';
import { trackAndAutoComplete } from './todo-state-tracker.js';
import type {
  TodoUpdateInteractionMessage,
  InteractionPromptMessage,
  ApprovalInteractionMessage,
} from '@zclaudia/shared/interaction/forms';

export interface InteractionToolsConfig {
  getServerPort: () => number | null;
}

/** HTTP POST to self (localhost) — reuses existing route handlers. */
function selfPost(
  port: number,
  path: string,
  body: Record<string, unknown>,
  timeoutMs = 30_000
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
        timeout: timeoutMs,
      },
      res => {
        let raw = '';
        res.on('data', c => {
          raw += c;
        });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 500, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode || 500, body: { raw } });
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy(new Error('selfPost timeout'));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

export function registerInteractionTools(config?: InteractionToolsConfig): void {
  // ============================================
  // update_todo_list — fire-and-forget
  // ============================================
  toolRegistry.register({
    id: 'update_todo_list',
    source: 'interaction',
    definition: {
      type: 'function',
      function: {
        name: 'update_todo_list',
        description:
          'Update the visible task list for the user. Call this to show progress on multi-step tasks. Each call replaces the previous list.',
        parameters: {
          type: 'object',
          properties: {
            todos: {
              type: 'array',
              maxItems: MAX_TODO_ITEMS,
              items: {
                type: 'object',
                properties: {
                  content: {
                    type: 'string',
                    maxLength: MAX_TODO_CONTENT_CHARS,
                    description: 'Task description',
                  },
                  status: {
                    type: 'string',
                    enum: ['pending', 'in_progress', 'completed', 'cancelled'],
                    description: 'Task status',
                  },
                },
                required: ['content', 'status'],
              },
              description: 'The full task list (replaces previous)',
            },
          },
          required: ['todos'],
        },
      },
    },
    handler: async (args, context) => {
      const sessionId = (context?.sessionId as string) || '';
      const interactionId = newId();
      const validation = validateTodoItems(args.todos);
      if (!validation.ok) {
        return JSON.stringify({
          success: false,
          error: validation.code,
          message: validation.message,
          ...validation.details,
        });
      }
      const todos = validation.todos;

      // Auto-complete items in previous todo lists that disappeared from the new list
      for (const update of trackAndAutoComplete(sessionId, interactionId, todos)) {
        interactionDispatcher.dispatchFireAndForget(sessionId, {
          type: 'interaction_todo_update',
          interactionId: update.interactionId,
          sessionId,
          source: 'tool_call',
          createdAt: Date.now(),
          todos: update.todos,
        });
      }

      const event: TodoUpdateInteractionMessage = {
        type: 'interaction_todo_update',
        interactionId,
        sessionId,
        source: 'tool_call',
        createdAt: Date.now(),
        todos,
      };

      interactionDispatcher.dispatchFireAndForget(sessionId, event);
      return JSON.stringify({ success: true, interactionId });
    },
  });

  // ============================================
  // ask_user_form — blocks until user responds
  // ============================================
  toolRegistry.register({
    id: 'ask_user_form',
    source: 'interaction',
    definition: {
      type: 'function',
      function: {
        name: 'ask_user_form',
        description:
          'Present a structured form to the user and wait for their response. Use this when you need specific structured input — multiple fields, choices, or confirmations.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Form title' },
            description: { type: 'string', description: 'Optional description or instructions' },
            fields: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: 'Unique field ID (used as key in response)' },
                  label: { type: 'string', description: 'Display label' },
                  type: {
                    type: 'string',
                    enum: ['text', 'select', 'multiselect', 'textarea', 'confirm'],
                    description: 'Field type',
                  },
                  options: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        value: { type: 'string' },
                        label: { type: 'string' },
                      },
                      required: ['value', 'label'],
                    },
                    description: 'Options for select/multiselect fields',
                  },
                  required: { type: 'boolean', description: 'Whether field is required' },
                  defaultValue: { type: 'string', description: 'Default value' },
                  placeholder: { type: 'string', description: 'Placeholder text' },
                },
                required: ['id', 'label', 'type'],
              },
              description: 'Form fields',
            },
          },
          required: ['title', 'fields'],
        },
      },
    },
    handler: async (args, context) => {
      const sessionId = (context?.sessionId as string) || '';
      const interactionId = newId();

      const event: InteractionPromptMessage = {
        type: 'interaction_prompt',
        interactionId,
        sessionId,
        source: 'tool_call',
        createdAt: Date.now(),
        title: (args.title as string) || 'Form',
        description: args.description as string | undefined,
        fields: (args.fields as InteractionPromptMessage['fields']) || [],
        submitLabel: 'Submit',
        responseMode: 'interaction_response',
        variant: 'form',
      };

      const response = await interactionDispatcher.dispatchAndWait(interactionId, sessionId, event);
      if (response.error) {
        throw new Error(String(response.error));
      }
      return JSON.stringify(response);
    },
  });

  // ============================================
  // request_approval — blocks until user approves/rejects
  // ============================================
  toolRegistry.register({
    id: 'request_approval',
    source: 'interaction',
    definition: {
      type: 'function',
      function: {
        name: 'request_approval',
        description:
          'Request user approval before proceeding with an action. Blocks until the user approves or rejects. Use this for destructive, irreversible, or high-impact operations.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short title for the approval request' },
            message: {
              type: 'string',
              description: 'Detailed description of what will happen if approved',
            },
            approveLabel: {
              type: 'string',
              description: 'Custom label for the approve button (default: "Approve")',
            },
            rejectLabel: {
              type: 'string',
              description: 'Custom label for the reject button (default: "Reject")',
            },
          },
          required: ['title', 'message'],
        },
      },
    },
    handler: async (args, context) => {
      const sessionId = (context?.sessionId as string) || '';
      const interactionId = newId();

      const event: ApprovalInteractionMessage = {
        type: 'interaction_approval',
        interactionId,
        sessionId,
        source: 'tool_call',
        createdAt: Date.now(),
        title: (args.title as string) || 'Approval Required',
        message: (args.message as string) || '',
        approveLabel: args.approveLabel as string | undefined,
        rejectLabel: args.rejectLabel as string | undefined,
      };

      const response = await interactionDispatcher.dispatchAndWait(interactionId, sessionId, event);

      if (response.error) {
        throw new Error(String(response.error));
      }

      if (response.approved !== true) {
        const feedback =
          typeof response.feedback === 'string' && response.feedback.trim()
            ? response.feedback.trim()
            : 'Plan rejected by user';
        throw new Error(feedback);
      }

      return JSON.stringify(response);
    },
  });

  // ============================================
  // push_file — fire-and-forget, pushes file to user's device
  // ============================================
  toolRegistry.register({
    id: 'push_file',
    source: 'interaction',
    definition: {
      type: 'function',
      function: {
        name: 'push_file',
        description:
          "Push a local file to the user's device. Use this when you build, generate, or export files (images, APKs, binaries, archives, documents, etc.) that the user needs. Images and small files (<500KB) auto-download; larger files show a download notification.",
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Absolute path to the file to push' },
            description: {
              type: 'string',
              description: 'Brief description of the file (shown in notification)',
            },
          },
          required: ['filePath'],
        },
      },
    },
    handler: async (args, context) => {
      const sessionId = (context?.sessionId as string) || '';
      const filePath = args.filePath as string;

      if (!filePath) {
        return JSON.stringify({ error: 'filePath is required' });
      }

      const port = config?.getServerPort?.();
      if (!port) {
        return JSON.stringify({ error: 'Server port not available' });
      }

      try {
        const result = await selfPost(port, '/api/files/push', {
          filePath,
          sessionId,
          description: (args.description as string) || undefined,
        });

        if (result.status === 200 && result.body.success) {
          const data = result.body.data as Record<string, unknown>;
          return JSON.stringify({
            success: true,
            fileName: data.fileName,
            fileSize: data.fileSize,
            autoDownload: data.autoDownload,
          });
        }
        return JSON.stringify({
          error: (result.body.error as Record<string, unknown>)?.message || 'Push failed',
        });
      } catch (err) {
        return JSON.stringify({
          error: `Push failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    },
  });

  // Plan mode moved to first-class builtin tools (EnterPlanMode / ExitPlanMode
  // in tool-bridge.ts): the read-only capability is core, and the approval
  // dialog is folded in as ExitPlanMode's optional `plan` flow (same
  // interaction_plan_review event, so the UI is unchanged).

  console.log(
    '[InteractionTools] Registered 4 interaction tools: update_todo_list, ask_user_form, request_approval, push_file'
  );
}
