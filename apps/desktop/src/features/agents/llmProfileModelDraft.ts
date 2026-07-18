import type { LlmModelDialect, LlmProfileModelEntry } from '@zclaudia/shared';

/**
 * Draft shape used by the Models repeater. We keep contextWindow / maxTokens as
 * raw strings so the editor can distinguish "empty (no override)" from
 * "0/non-numeric (validation error)" without lossy coercion on every keystroke.
 */
export interface ModelRowDraft {
  /**
   * Stable per-row identifier independent of array index. Used as the key for
   * the testStatus auto-clear timer Map so reordering / row deletion above the
   * probed row can't clear the wrong row's status when the timer fires.
   */
  rowUid: string;
  modelId: string;
  displayName: string;
  contextWindowStr: string;
  maxTokensStr: string;
  /** '' = Auto (no forced dialect). */
  dialect: '' | LlmModelDialect;
  supportsImage: boolean;
  inputModalitiesTouched: boolean;
  /** Last probe result; cleared after a few seconds via a setTimeout. */
  testStatus?:
    | { kind: 'running' }
    | { kind: 'ok'; latencyMs: number }
    | { kind: 'fail'; error: string };
}

export function generateRowUid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function entryToDraft(entry: LlmProfileModelEntry): ModelRowDraft {
  return {
    rowUid: generateRowUid(),
    modelId: entry.modelId,
    displayName: entry.displayName ?? '',
    contextWindowStr: entry.contextWindow != null ? String(entry.contextWindow) : '',
    maxTokensStr: entry.maxTokens != null ? String(entry.maxTokens) : '',
    dialect: entry.dialect ?? '',
    supportsImage: entry.inputModalities?.includes('image') ?? false,
    inputModalitiesTouched: entry.inputModalities !== undefined,
  };
}

function parsePositiveInteger(raw: string): { value: number | undefined; error: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) return { value: undefined, error: null };
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    return { value: undefined, error: 'must be a positive integer' };
  }
  return { value: n, error: null };
}

export interface ModelRowError {
  modelId?: string;
  contextWindow?: string;
  maxTokens?: string;
}

export function validateModelDraftRow(
  draft: ModelRowDraft,
  allDrafts: ModelRowDraft[],
  index: number
): ModelRowError {
  const err: ModelRowError = {};
  const id = draft.modelId.trim();
  if (!id) {
    err.modelId = 'required';
  } else {
    const dup = allDrafts.findIndex((d, i) => i !== index && d.modelId.trim() === id);
    if (dup !== -1) err.modelId = 'duplicate';
  }
  const cw = parsePositiveInteger(draft.contextWindowStr);
  if (cw.error) err.contextWindow = cw.error;
  const mt = parsePositiveInteger(draft.maxTokensStr);
  if (mt.error) err.maxTokens = mt.error;
  return err;
}

/**
 * Serialize draft rows into the wire shape. Drops rows with empty modelId so a
 * half-typed "Add model" row never blocks save.
 */
export function draftsToEntries(drafts: ModelRowDraft[]): LlmProfileModelEntry[] {
  const out: LlmProfileModelEntry[] = [];
  for (const d of drafts) {
    const id = d.modelId.trim();
    if (!id) continue;
    const entry: LlmProfileModelEntry = { modelId: id };
    const display = d.displayName.trim();
    if (display) entry.displayName = display;
    const cw = parsePositiveInteger(d.contextWindowStr);
    if (cw.value !== undefined) entry.contextWindow = cw.value;
    const mt = parsePositiveInteger(d.maxTokensStr);
    if (mt.value !== undefined) entry.maxTokens = mt.value;
    if (d.supportsImage) entry.inputModalities = ['text', 'image'];
    else if (d.inputModalitiesTouched) entry.inputModalities = ['text'];
    if (d.dialect) entry.dialect = d.dialect;
    out.push(entry);
  }
  return out;
}
