import { describe, expect, it } from 'vitest';
import { resolveAcpModelId, resolveAcpModeId } from '../acp-models.js';
import { CursorAcpError } from '../errors.js';

const MODELS = {
  currentModelId: 'default[]',
  availableModels: [
    { modelId: 'default[]', name: 'Auto' },
    { modelId: 'fake-model[thinking=true,context=9k]', name: 'fake-model' },
  ],
};

describe('resolveAcpModelId', () => {
  it('keeps the session model and skips set_model when nothing is requested', () => {
    expect(resolveAcpModelId(MODELS, undefined)).toEqual({});
    expect(resolveAcpModelId(MODELS, '')).toEqual({});
    expect(resolveAcpModelId(MODELS, '   ')).toEqual({});
  });

  it('matches an exact parameterized modelId first (§7.4)', () => {
    expect(resolveAcpModelId(MODELS, 'fake-model[thinking=true,context=9k]')).toEqual({
      modelId: 'fake-model[thinking=true,context=9k]',
      displayName: 'fake-model',
    });
  });

  it('matches a bare display name to its full modelId (§7.4)', () => {
    expect(resolveAcpModelId(MODELS, 'fake-model')).toEqual({
      modelId: 'fake-model[thinking=true,context=9k]',
      displayName: 'fake-model',
    });
  });

  it('fast-fails on an unknown explicit model instead of falling back to default[]', () => {
    expect(() => resolveAcpModelId(MODELS, 'nope')).toThrowError(CursorAcpError);
    try {
      resolveAcpModelId(MODELS, 'nope');
    } catch (error) {
      expect((error as CursorAcpError).code).toBe('CURSOR_MODEL_UNSUPPORTED');
    }
  });

  it('fails when a model is requested but the agent sent no model list', () => {
    expect(() => resolveAcpModelId(undefined, 'fake-model')).toThrowError(CursorAcpError);
  });
});

describe('resolveAcpModeId', () => {
  const MODES = [
    { id: 'agent', name: 'Agent' },
    { id: 'plan', name: 'Plan' },
    { id: 'ask', name: 'Ask' },
  ];

  it('maps default and bypassPermissions onto agent (§8.1)', () => {
    expect(resolveAcpModeId(MODES, 'agent', 'default')).toEqual({});
    expect(resolveAcpModeId(MODES, 'ask', 'bypassPermissions').modeId).toBe('agent');
  });

  it('maps plan and ask by advertised id, not display name', () => {
    expect(resolveAcpModeId(MODES, 'agent', 'plan').modeId).toBe('plan');
    expect(resolveAcpModeId(MODES, 'agent', 'ask').modeId).toBe('ask');
  });

  it('skips set_mode when the session is already in the target mode', () => {
    expect(resolveAcpModeId(MODES, 'plan', 'plan')).toEqual({});
  });

  it('fails when the requested mode is not advertised (§8.1)', () => {
    try {
      resolveAcpModeId([{ id: 'agent', name: 'Agent' }], 'agent', 'plan');
      expect.unreachable();
    } catch (error) {
      expect((error as CursorAcpError).code).toBe('CURSOR_ACP_MODE_UNSUPPORTED');
    }
  });
});
