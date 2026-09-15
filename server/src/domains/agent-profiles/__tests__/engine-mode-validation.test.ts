import { describe, expect, it } from 'vitest';
import {
  validateEngineModeConfiguration,
  engineModeForResponse,
} from '../engine-mode-validation.js';
import { runtimeDescriptorRegistry } from '../../../infra/providers/runtime-descriptor-registry.js';
import { LlmProfileRepository } from '../../llm-profiles/repository.js';
import type { AgentRuntimeContribution } from '@zclaudia/shared/providers';
import Database from 'better-sqlite3';
import { applyPendingMigrations } from '../../../infra/storage/migrations/index.js';

const dualModeContribution = {
  type: 'claude',
  label: 'Test Dual',
  model: { kind: 'native', multimodalFallback: false, thinkingLevel: 'auto' },
  hasCliPath: true,
  capabilities: { tools: 'native-readonly', providers: 'external', skills: 'external' },
  defaultEngineMode: 'cli',
  engineModes: [
    {
      id: 'cli',
      label: 'CLI',
      connection: { kind: 'external', modelSelection: 'optional' },
      executable: 'external-cli',
      modelOptions: { multimodalFallback: false, thinkingLevel: 'auto' },
      capabilities: { tools: 'native-readonly', skills: 'external' },
    },
    {
      id: 'sdk',
      label: 'SDK',
      connection: { kind: 'llm-profile', acceptedModelProtocols: ['anthropic-messages'] },
      executable: 'bundled-sdk',
      modelOptions: { multimodalFallback: false, thinkingLevel: 'auto' },
      capabilities: { tools: 'native-readonly', skills: 'external' },
    },
  ],
} as unknown as AgentRuntimeContribution;

function setup() {
  const db = new Database(':memory:');
  applyPendingMigrations(db);
  const llmRepo = new LlmProfileRepository(db);
  llmRepo.create({ name: 'Anthropic', providerType: 'anthropic', apiKey: 'sk-1' });
  llmRepo.create({ name: 'NoKey', providerType: 'anthropic', apiKey: undefined });
  return { db, llmRepo };
}

describe('validateEngineModeConfiguration', () => {
  it('validates a complete sdk configuration atomically', () => {
    const { db, llmRepo } = setup();
    runtimeDescriptorRegistry.registerForPlugin('test-plugin', dualModeContribution);
    try {
      const profiles = llmRepo.findAllOrdered();
      const anthropic = profiles.find(p => p.name === 'Anthropic')!;
      const result = validateEngineModeConfiguration({
        runtimeType: 'claude',
        requestedEngineMode: 'sdk',
        engineModeExplicit: true,
        mergedLlmProfileId: anthropic.id,
        mergedModel: 'claude-opus-4-8',
        mergedCliPath: null,
        llmRepo,
      });
      expect(result).toMatchObject({ ok: true, engineMode: 'sdk', llmProfileId: anthropic.id });
      void db;
    } finally {
      runtimeDescriptorRegistry.unregisterForPlugin?.('test-plugin');
    }
  });

  it('rejects sdk without a binding even when the patch did not touch the binding', () => {
    const { llmRepo } = setup();
    runtimeDescriptorRegistry.registerForPlugin('test-plugin', dualModeContribution);
    try {
      const result = validateEngineModeConfiguration({
        runtimeType: 'claude',
        requestedEngineMode: 'sdk',
        engineModeExplicit: true,
        mergedLlmProfileId: null,
        mergedModel: '',
        mergedCliPath: null,
        llmRepo,
      });
      expect(result).toMatchObject({ ok: false, code: 'LLM_PROFILE_REQUIRED' });
    } finally {
      runtimeDescriptorRegistry.unregisterForPlugin?.('test-plugin');
    }
  });

  it('rejects sdk with a cli path (field not applicable)', () => {
    const { llmRepo } = setup();
    runtimeDescriptorRegistry.registerForPlugin('test-plugin', dualModeContribution);
    try {
      const anthropic = llmRepo.findAllOrdered().find(p => p.name === 'Anthropic')!;
      const result = validateEngineModeConfiguration({
        runtimeType: 'claude',
        requestedEngineMode: 'sdk',
        engineModeExplicit: true,
        mergedLlmProfileId: anthropic.id,
        mergedModel: 'm',
        mergedCliPath: '/usr/local/bin/claude',
        llmRepo,
      });
      expect(result).toMatchObject({ ok: false, code: 'FIELD_NOT_APPLICABLE' });
    } finally {
      runtimeDescriptorRegistry.unregisterForPlugin?.('test-plugin');
    }
  });

  it('rejects unknown modes', () => {
    const { llmRepo } = setup();
    runtimeDescriptorRegistry.registerForPlugin('test-plugin', dualModeContribution);
    try {
      const result = validateEngineModeConfiguration({
        runtimeType: 'claude',
        requestedEngineMode: 'serverless',
        engineModeExplicit: true,
        mergedLlmProfileId: null,
        mergedModel: '',
        mergedCliPath: null,
        llmRepo,
      });
      expect(result).toMatchObject({ ok: false, code: 'ENGINE_MODE_UNSUPPORTED' });
    } finally {
      runtimeDescriptorRegistry.unregisterForPlugin?.('test-plugin');
    }
  });

  it('keeps legacy cli bindings when the mode is untouched', () => {
    const { llmRepo } = setup();
    const result = validateEngineModeConfiguration({
      runtimeType: 'claude',
      requestedEngineMode: null,
      engineModeExplicit: false,
      mergedLlmProfileId: 'legacy-profile-id',
      mergedModel: '',
      mergedCliPath: '/usr/bin/claude',
      llmRepo,
    });
    // Legacy value survives an unrelated edit (it is never used as engine auth).
    expect(result).toMatchObject({
      ok: true,
      llmProfileId: 'legacy-profile-id',
      llmProfileIdForced: false,
    });
  });
});

describe('engineModeForResponse', () => {
  it('normalizes unset claude engine mode to cli', () => {
    expect(engineModeForResponse({ runtimeType: 'claude', llmProfileId: null } as never)).toBe(
      'cli'
    );
  });

  it('returns undefined for runtimes without modes', () => {
    expect(
      engineModeForResponse({ runtimeType: 'zclaudia', llmProfileId: null } as never)
    ).toBeUndefined();
  });
});
