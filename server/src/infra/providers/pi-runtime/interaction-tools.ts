import type { AgentTool } from '@earendil-works/pi-agent-core';

import {
  MAX_TODO_CONTENT_CHARS,
  MAX_TODO_ITEMS,
  validateTodoItems,
} from '../../../application/conversation/interactions/todo-normalizer.js';
import type { PermissionCallback } from '../types.js';
import { errorResult, jsonResult, textResult, toolParams } from './tool-common.js';

type AgentToolParameters = AgentTool['parameters'];

function agentToolParameters(schema: Record<string, unknown>): AgentToolParameters {
  return schema as AgentToolParameters;
}

function extractAskUserQuestionDetail(args: Record<string, unknown>): string {
  const questions = args.questions;
  if (Array.isArray(questions)) {
    const [firstQuestion] = questions;
    if (firstQuestion && typeof firstQuestion === 'object') {
      const question = (firstQuestion as { question?: unknown }).question;
      if (typeof question === 'string' && question.trim()) {
        const extra = questions.length > 1 ? ` (+${questions.length - 1} more)` : '';
        return question.trim() + extra;
      }
    }
  }
  return 'AskUserQuestion';
}

export function createTodoWriteTool(): AgentTool {
  return {
    name: 'TodoWrite',
    label: 'TodoWrite',
    description: 'Update the visible task list for the user.',
    parameters: agentToolParameters({
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          maxItems: MAX_TODO_ITEMS,
          items: {
            type: 'object',
            properties: {
              content: { type: 'string', maxLength: MAX_TODO_CONTENT_CHARS },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed', 'cancelled'],
              },
            },
            required: ['content', 'status'],
          },
        },
      },
      required: ['todos'],
    }),
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      const validation = validateTodoItems(args);
      if (!validation.ok) {
        return errorResult(validation.code, validation.message, validation.details);
      }
      const todos = validation.todos;
      return jsonResult({ success: true, count: todos.length, todos });
    },
  };
}

export function createAskUserQuestionTool(permissionCallback?: PermissionCallback): AgentTool {
  return {
    name: 'AskUserQuestion',
    label: 'AskUserQuestion',
    description: 'Ask the user one or more structured questions and wait for an answer.',
    parameters: agentToolParameters({
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              question: { type: 'string' },
              header: { type: 'string' },
              options: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string' },
                    description: { type: 'string' },
                  },
                  required: ['label', 'description'],
                },
              },
              multiSelect: { type: 'boolean' },
              allowCustomValue: { type: 'boolean' },
            },
            required: ['question', 'header', 'options'],
          },
        },
      },
      required: ['questions'],
    }),
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      if (!permissionCallback) {
        return errorResult(
          'missing_interaction_callback',
          'AskUserQuestion requires the ZClaudia interaction callback'
        );
      }
      const decision = await permissionCallback({
        requestId: toolCallId,
        toolName: 'AskUserQuestion',
        toolInput: args,
        detail: extractAskUserQuestionDetail(args),
        timeoutSeconds: 0,
      });
      return textResult(decision.message?.trim() || 'No answer provided.', {
        ok: true,
        answered: true,
        behavior: decision.behavior,
      });
    },
  };
}
