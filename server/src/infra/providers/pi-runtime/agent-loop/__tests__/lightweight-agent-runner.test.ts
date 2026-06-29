import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { migration as m001 } from '../../../../storage/migrations/001_initial_schema.js';
import { migration as m003 } from '../../../../storage/migrations/003_llm_profile_models.js';
import { migration as m028 } from '../../../../storage/migrations/028_agent_loop_contexts.js';
import { LightweightAgentRunner, type AgentLoopExecutor } from '../lightweight-agent-runner.js';

describe('LightweightAgentRunner', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(m001.sql);
    db.exec(m003.sql);
    db.exec(m028.sql);
    db.prepare(`
      INSERT INTO llm_profiles (id, name, provider_type, base_url, api_key, models, is_default, created_at, updated_at)
      VALUES ('llm-1', 'Test LLM', 'openai', NULL, 'key', '[{"modelId":"gpt-4o","inputModalities":["text","image"]}]', 1, 1, 1)
    `).run();
  });

  it('runs a bounded agent loop and returns parsed JSON output', async () => {
    const execute: AgentLoopExecutor = vi.fn(async () => ({
      text: '{"result":"done"}',
      messages: [],
      usage: { output: 5 },
    }));
    const runner = new LightweightAgentRunner({ db, executeAgentLoop: execute, now: () => 2_000 });

    const result = await runner.run({
      owner: { type: 'workflow_run', id: 'run-1' },
      purpose: 'workflow.ai_prompt',
      llmProfileId: 'llm-1',
      model: 'gpt-4o',
      cwd: '/tmp',
      systemPrompt: 'system',
      input: 'say done',
      toolset: { id: 'none' },
      outputContract: {
        type: 'json',
        schema: {
          type: 'object',
          required: ['result'],
          properties: { result: { type: 'string' } },
        },
        repairAttempts: 1,
      },
      context: { policy: 'none' },
      limits: { maxTurns: 2, timeoutMs: 1_000 },
      permissionMode: 'deny-external',
    });

    expect(result).toMatchObject({
      status: 'completed',
      output: { result: 'done' },
      usage: { output: 5 },
    });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      userInput: 'say done',
      maxTurns: 2,
      timeoutMs: 1_000,
    }));
    const events = db.prepare('SELECT kind FROM agent_loop_events ORDER BY created_at ASC, rowid ASC').all();
    expect(events).toEqual([
      { kind: 'input' },
      { kind: 'assistant_message' },
      { kind: 'contract_result' },
    ]);
  });

  it('uses one repair attempt for invalid JSON output', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ text: 'not json', messages: [] })
      .mockResolvedValueOnce({ text: '{"result":"repaired"}', messages: [] });
    const runner = new LightweightAgentRunner({ db, executeAgentLoop: execute });

    const result = await runner.run({
      owner: { type: 'workflow_run', id: 'run-1' },
      purpose: 'workflow.ai_prompt',
      llmProfileId: 'llm-1',
      cwd: '/tmp',
      systemPrompt: 'system',
      input: 'say done',
      toolset: { id: 'none' },
      outputContract: {
        type: 'json',
        schema: {
          type: 'object',
          required: ['result'],
          properties: { result: { type: 'string' } },
        },
        repairAttempts: 1,
      },
      context: { policy: 'none' },
      limits: { maxTurns: 2, timeoutMs: 1_000 },
      permissionMode: 'deny-external',
    });

    expect(result.output).toEqual({ result: 'repaired' });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1]?.[0]?.userInput).toContain('Return valid JSON only');
  });

  it('returns contract_failed when repair still fails', async () => {
    const runner = new LightweightAgentRunner({
      db,
      executeAgentLoop: vi.fn(async () => ({ text: 'still bad', messages: [] })),
    });

    const result = await runner.run({
      owner: { type: 'workflow_run', id: 'run-1' },
      purpose: 'workflow.ai_prompt',
      llmProfileId: 'llm-1',
      cwd: '/tmp',
      systemPrompt: 'system',
      input: 'say done',
      toolset: { id: 'none' },
      outputContract: {
        type: 'json',
        schema: {
          type: 'object',
          required: ['result'],
          properties: { result: { type: 'string' } },
        },
        repairAttempts: 1,
      },
      context: { policy: 'none' },
      limits: { maxTurns: 2, timeoutMs: 1_000 },
      permissionMode: 'deny-external',
    });

    expect(result.status).toBe('contract_failed');
    expect(result.error).toContain('valid JSON');
  });

  it('fails unknown toolsets before calling the model', async () => {
    const execute = vi.fn();
    const runner = new LightweightAgentRunner({ db, executeAgentLoop: execute });

    const result = await runner.run({
      owner: { type: 'workflow_run', id: 'run-1' },
      purpose: 'workflow.ai_prompt',
      llmProfileId: 'llm-1',
      cwd: '/tmp',
      systemPrompt: 'system',
      input: 'say done',
      toolset: { id: 'missing' },
      outputContract: { type: 'json', schema: { type: 'object' } },
      context: { policy: 'none' },
      limits: { maxTurns: 2, timeoutMs: 1_000 },
      permissionMode: 'deny-external',
    });

    expect(result.status).toBe('failed');
    expect(execute).not.toHaveBeenCalled();
  });
});
