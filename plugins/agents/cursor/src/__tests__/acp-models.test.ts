import { describe, expect, it } from 'vitest';
import { parseCursorContextWindow, resolveAcpModelId, resolveAcpModeId } from '../acp-models.js';
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

describe('parseCursorContextWindow', () => {
  it('reads the context parameter from probed modelIds', () => {
    expect(
      parseCursorContextWindow('claude-opus-5[thinking=true,context=300k,effort=high,fast=false]')
    ).toBe(300_000);
    expect(parseCursorContextWindow('gpt-5.6-sol[context=272k,reasoning=medium,fast=false]')).toBe(
      272_000
    );
    expect(parseCursorContextWindow('opus[effort=high,context=1m]')).toBe(1_000_000);
  });

  it('accepts a bare token count and fractional units', () => {
    expect(parseCursorContextWindow('m[context=128000]')).toBe(128_000);
    expect(parseCursorContextWindow('m[context=1.5m]')).toBe(1_500_000);
    expect(parseCursorContextWindow('m[CONTEXT=200K]')).toBe(200_000);
  });

  it('returns undefined rather than guessing when no window is encoded', () => {
    expect(parseCursorContextWindow(undefined)).toBeUndefined();
    expect(parseCursorContextWindow('default[]')).toBeUndefined();
    expect(parseCursorContextWindow('composer')).toBeUndefined();
    expect(parseCursorContextWindow('m[thinking=true]')).toBeUndefined();
    expect(parseCursorContextWindow('m[context=auto]')).toBeUndefined();
    expect(parseCursorContextWindow('m[context=0k]')).toBeUndefined();
  });
});
