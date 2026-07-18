import { describe, expect, it } from 'vitest';
import {
  draftsToEntries,
  entryToDraft,
  validateModelDraftRow,
  type ModelRowDraft,
} from '../llmProfileModelDraft';

function draft(patch: Partial<ModelRowDraft>): ModelRowDraft {
  return {
    rowUid: patch.rowUid ?? 'row-1',
    modelId: patch.modelId ?? '',
    displayName: patch.displayName ?? '',
    contextWindowStr: patch.contextWindowStr ?? '',
    maxTokensStr: patch.maxTokensStr ?? '',
    supportsImage: patch.supportsImage ?? false,
    inputModalitiesTouched: patch.inputModalitiesTouched ?? false,
    dialect: patch.dialect ?? '',
    testStatus: patch.testStatus,
  };
}

describe('llmProfileModelDraft', () => {
  it('validates required, duplicate, and positive integer fields', () => {
    const rows = [
      draft({ modelId: 'claude-sonnet', contextWindowStr: '0' }),
      draft({ rowUid: 'row-2', modelId: 'claude-sonnet', maxTokensStr: 'abc' }),
    ];

    expect(validateModelDraftRow(rows[0], rows, 0)).toEqual({
      modelId: 'duplicate',
      contextWindow: 'must be a positive integer',
    });
    expect(validateModelDraftRow(draft({ modelId: '   ' }), [], 0)).toEqual({
      modelId: 'required',
    });
    expect(validateModelDraftRow(rows[1], rows, 1)).toEqual({
      modelId: 'duplicate',
      maxTokens: 'must be a positive integer',
    });
  });

  it('serializes complete drafts and drops empty placeholder rows', () => {
    const entries = draftsToEntries([
      draft({
        modelId: ' claude-sonnet ',
        displayName: ' Sonnet ',
        contextWindowStr: '200000',
        maxTokensStr: '8192',
        supportsImage: true,
      }),
      draft({ rowUid: 'empty' }),
      draft({
        rowUid: 'text-only',
        modelId: 'text-model',
        inputModalitiesTouched: true,
      }),
    ]);

    expect(entries).toEqual([
      {
        modelId: 'claude-sonnet',
        displayName: 'Sonnet',
        contextWindow: 200000,
        maxTokens: 8192,
        inputModalities: ['text', 'image'],
      },
      {
        modelId: 'text-model',
        inputModalities: ['text'],
      },
    ]);
  });

  it('round-trips dialect through draft and entries', () => {
    const entries = draftsToEntries([
      draft({ modelId: 'kimi-k2', dialect: 'moonshotai' }),
      draft({ rowUid: 'row-2', modelId: 'plain-model', dialect: '' }),
    ]);
    expect(entries[0].dialect).toBe('moonshotai');
    expect('dialect' in entries[1]).toBe(false);

    expect(entryToDraft({ modelId: 'kimi-k2', dialect: 'moonshotai' }).dialect).toBe('moonshotai');
    expect(entryToDraft({ modelId: 'plain-model' }).dialect).toBe('');
  });
});
