/**
 * Narrow types and runtime guards for Cursor's private ACP extensions
 * (design doc §10). These never mix into the standard ACP types; every payload
 * is guarded so a drifting extension can degrade per-method (probed baseline:
 * `-32601` replies do not crash the session) without breaking the standard
 * session.
 *
 * Payload schemas follow Cursor's published ACP extension documentation and the
 * P0 probes (`probes/fixtures/*.json`); local behavior beyond the probes is
 * verified on CLI upgrades by re-running the probe suite.
 */

// ── Cursor session models state ──────────────────────────────────────────────
// `session/new` and `session/load` carry an extra `models` field alongside the
// standard `modes`. SDK 1.4.0 does not type it; it survives at runtime because
// client-side responses are not schema-stripped.

export interface CursorModelInfo {
  modelId: string;
  name: string;
}

export interface CursorSessionModelsState {
  currentModelId: string;
  availableModels: CursorModelInfo[];
}

/** Runtime guard for the undocumented-but-probed `models` session field. */
export function readSessionModels(response: unknown): CursorSessionModelsState | undefined {
  if (!response || typeof response !== 'object') return undefined;
  const models = (response as { models?: unknown }).models;
  if (!models || typeof models !== 'object') return undefined;
  const record = models as {
    currentModelId?: unknown;
    availableModels?: unknown;
  };
  if (typeof record.currentModelId !== 'string') return undefined;
  if (!Array.isArray(record.availableModels)) return undefined;
  const availableModels: CursorModelInfo[] = [];
  for (const entry of record.availableModels) {
    if (!entry || typeof entry !== 'object') continue;
    const { modelId, name } = entry as { modelId?: unknown; name?: unknown };
    if (typeof modelId === 'string' && typeof name === 'string') {
      availableModels.push({ modelId, name });
    }
  }
  return { currentModelId: record.currentModelId, availableModels };
}

// ── cursor/create_plan (blocking request, v1-mandatory, design doc §10.1) ────

export interface CursorCreatePlanPayload {
  toolCallId: string;
  plan: string;
  todos: CursorTodoItem[];
  name?: string;
  overview?: string;
  isProject?: boolean;
  phases?: Array<{ name: string; todos: CursorTodoItem[] }>;
}

export type CursorCreatePlanOutcome =
  | { outcome: 'accepted'; planUri?: string }
  | { outcome: 'rejected'; reason?: string }
  | { outcome: 'cancelled' };

export interface CursorCreatePlanResponse {
  outcome: CursorCreatePlanOutcome;
}

/** Narrow an inbound `cursor/create_plan` request; `undefined` means "not our shape". */
export function readCreatePlanPayload(params: unknown): CursorCreatePlanPayload | undefined {
  if (!params || typeof params !== 'object') return undefined;
  const record = params as {
    toolCallId?: unknown;
    name?: unknown;
    overview?: unknown;
    plan?: unknown;
    todos?: unknown;
    isProject?: unknown;
    phases?: unknown;
  };
  if (
    typeof record.toolCallId !== 'string' ||
    !record.toolCallId ||
    typeof record.plan !== 'string' ||
    !Array.isArray(record.todos)
  )
    return undefined;
  const todos = readTodoItems(record.todos);
  if (!todos || todos.length !== record.todos.length) return undefined;
  let phases: CursorCreatePlanPayload['phases'];
  if (record.phases !== undefined) {
    if (!Array.isArray(record.phases)) return undefined;
    phases = [];
    for (const phaseValue of record.phases) {
      if (!phaseValue || typeof phaseValue !== 'object') return undefined;
      const phase = phaseValue as { name?: unknown; todos?: unknown };
      if (typeof phase.name !== 'string' || !Array.isArray(phase.todos)) return undefined;
      const phaseTodos = readTodoItems(phase.todos);
      if (!phaseTodos || phaseTodos.length !== phase.todos.length) return undefined;
      phases.push({ name: phase.name, todos: phaseTodos });
    }
  }
  return {
    toolCallId: record.toolCallId,
    plan: record.plan,
    todos,
    ...(typeof record.name === 'string' ? { name: record.name } : {}),
    ...(typeof record.overview === 'string' ? { overview: record.overview } : {}),
    ...(typeof record.isProject === 'boolean' ? { isProject: record.isProject } : {}),
    ...(phases ? { phases } : {}),
  };
}

// ── cursor/ask_question (blocking; first version answers "skipped") ─────────

export type CursorAskQuestionOutcome =
  | { outcome: 'answered'; answers: Array<{ questionId: string; selectedOptionIds: string[] }> }
  | { outcome: 'skipped'; reason?: string }
  | { outcome: 'cancelled' };

export interface CursorAskQuestionResponse {
  outcome: CursorAskQuestionOutcome;
}

export interface CursorAskQuestionPayload {
  toolCallId: string;
  title?: string;
  questions: Array<{
    id: string;
    prompt: string;
    options: Array<{ id: string; label: string }>;
    allowMultiple?: boolean;
  }>;
}

export function readAskQuestionPayload(params: unknown): CursorAskQuestionPayload | undefined {
  if (!params || typeof params !== 'object') return undefined;
  const record = params as { toolCallId?: unknown; title?: unknown; questions?: unknown };
  if (
    typeof record.toolCallId !== 'string' ||
    !record.toolCallId ||
    !Array.isArray(record.questions)
  )
    return undefined;
  const questions: CursorAskQuestionPayload['questions'] = [];
  for (const value of record.questions) {
    if (!value || typeof value !== 'object') return undefined;
    const question = value as {
      id?: unknown;
      prompt?: unknown;
      options?: unknown;
      allowMultiple?: unknown;
    };
    if (
      typeof question.id !== 'string' ||
      typeof question.prompt !== 'string' ||
      !Array.isArray(question.options)
    )
      return undefined;
    const options: Array<{ id: string; label: string }> = [];
    for (const optionValue of question.options) {
      if (!optionValue || typeof optionValue !== 'object') return undefined;
      const option = optionValue as { id?: unknown; label?: unknown };
      if (typeof option.id !== 'string' || typeof option.label !== 'string') return undefined;
      options.push({ id: option.id, label: option.label });
    }
    questions.push({
      id: question.id,
      prompt: question.prompt,
      options,
      ...(typeof question.allowMultiple === 'boolean'
        ? { allowMultiple: question.allowMultiple }
        : {}),
    });
  }
  return {
    toolCallId: record.toolCallId,
    questions,
    ...(typeof record.title === 'string' ? { title: record.title } : {}),
  };
}

/** Formal first-version decline for structured questions (§10.1). */
export function skippedAskQuestionResponse(reason: string): CursorAskQuestionResponse {
  return { outcome: { outcome: 'skipped', reason } };
}

// ── Fire-and-forget notifications: update_todos / task / generate_image ──────

export interface CursorTodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
}

export function readUpdateTodosPayload(
  params: unknown
): { toolCallId: string; todos: CursorTodoItem[]; merge: boolean } | undefined {
  if (!params || typeof params !== 'object') return undefined;
  const record = params as { toolCallId?: unknown; todos?: unknown; merge?: unknown };
  if (
    typeof record.toolCallId !== 'string' ||
    !record.toolCallId ||
    !Array.isArray(record.todos) ||
    typeof record.merge !== 'boolean'
  )
    return undefined;
  const todos = readTodoItems(record.todos);
  if (!todos || todos.length !== record.todos.length) return undefined;
  return { toolCallId: record.toolCallId, todos, merge: record.merge };
}

export function readSubagentTaskPayload(params: unknown):
  | {
      toolCallId: string;
      description: string;
      prompt: string;
      subagentType:
        | 'unspecified'
        | 'computer_use'
        | 'explore'
        | 'video_review'
        | 'browser_use'
        | 'shell'
        | 'vm_setup_helper'
        | { custom: string };
      model?: string;
      agentId?: string;
      durationMs?: number;
    }
  | undefined {
  if (!params || typeof params !== 'object') return undefined;
  const record = params as {
    toolCallId?: unknown;
    description?: unknown;
    prompt?: unknown;
    subagentType?: unknown;
    model?: unknown;
    agentId?: unknown;
    durationMs?: unknown;
  };
  if (
    typeof record.toolCallId !== 'string' ||
    !record.toolCallId ||
    typeof record.description !== 'string' ||
    typeof record.prompt !== 'string' ||
    !isSubagentType(record.subagentType)
  )
    return undefined;
  return {
    toolCallId: record.toolCallId,
    description: record.description,
    prompt: record.prompt,
    subagentType: record.subagentType,
    ...(typeof record.model === 'string' ? { model: record.model } : {}),
    ...(typeof record.agentId === 'string' ? { agentId: record.agentId } : {}),
    ...(typeof record.durationMs === 'number' && Number.isFinite(record.durationMs)
      ? { durationMs: record.durationMs }
      : {}),
  };
}

function isSubagentType(
  value: unknown
): value is
  | 'unspecified'
  | 'computer_use'
  | 'explore'
  | 'video_review'
  | 'browser_use'
  | 'shell'
  | 'vm_setup_helper'
  | { custom: string } {
  if (
    value === 'unspecified' ||
    value === 'computer_use' ||
    value === 'explore' ||
    value === 'video_review' ||
    value === 'browser_use' ||
    value === 'shell' ||
    value === 'vm_setup_helper'
  )
    return true;
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as { custom?: unknown }).custom === 'string'
  );
}

export function readGenerateImagePayload(params: unknown):
  | {
      toolCallId: string;
      description: string;
      filePath?: string;
      referenceImagePaths?: string[];
    }
  | undefined {
  if (!params || typeof params !== 'object') return undefined;
  const record = params as {
    toolCallId?: unknown;
    description?: unknown;
    filePath?: unknown;
    referenceImagePaths?: unknown;
  };
  if (
    typeof record.toolCallId !== 'string' ||
    !record.toolCallId ||
    typeof record.description !== 'string'
  )
    return undefined;
  if (
    record.referenceImagePaths !== undefined &&
    (!Array.isArray(record.referenceImagePaths) ||
      !record.referenceImagePaths.every(value => typeof value === 'string'))
  )
    return undefined;
  return {
    toolCallId: record.toolCallId,
    description: record.description,
    ...(typeof record.filePath === 'string' ? { filePath: record.filePath } : {}),
    ...(Array.isArray(record.referenceImagePaths)
      ? { referenceImagePaths: record.referenceImagePaths as string[] }
      : {}),
  };
}

function readTodoItems(values: unknown[]): CursorTodoItem[] | undefined {
  const todos: CursorTodoItem[] = [];
  for (const entry of values) {
    if (!entry || typeof entry !== 'object') return undefined;
    const { id, content, status } = entry as { id?: unknown; content?: unknown; status?: unknown };
    if (
      typeof id !== 'string' ||
      typeof content !== 'string' ||
      (status !== 'pending' &&
        status !== 'in_progress' &&
        status !== 'completed' &&
        status !== 'cancelled')
    )
      return undefined;
    todos.push({ id, content, status });
  }
  return todos;
}
