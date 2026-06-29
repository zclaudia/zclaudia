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
    const firstInput = (execute as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]?.userInput;
    expect(firstInput).toContain('say done');
    expect(firstInput).toContain('Required JSON Output');
    expect(firstInput).toContain('"result"');
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
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

  it('uses the first LLM profile model when request.model is omitted', async () => {
    const execute: AgentLoopExecutor = vi.fn(async () => ({
      text: '{"result":"done"}',
      messages: [],
    }));
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
      },
      context: { policy: 'none' },
      limits: { maxTurns: 2, timeoutMs: 1_000 },
      permissionMode: 'deny-external',
    });

    expect(result.status).toBe('completed');
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      modelInfo: expect.objectContaining({
        model: expect.objectContaining({
          id: 'gpt-4o',
          input: ['text', 'image'],
        }),
      }),
    }));
  });

  it('uses one repair attempt for invalid JSON output', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ text: 'not json', messages: [], usage: { input: 3, output: 1 } })
      .mockResolvedValueOnce({ text: '{"result":"repaired"}', messages: [], usage: { input: 5, output: 2 } });
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
    expect(result.usage).toEqual({ input: 8, output: 3 });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1]?.[0]?.userInput).toContain('Return valid JSON only');
    expect(execute.mock.calls[1]?.[0]?.userInput).toContain('"result"');
  });

  it('includes the specific schema validation error in the repair prompt', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ text: '{}', messages: [] })
      .mockResolvedValueOnce({ text: '{"result":"repaired"}', messages: [] });
    const runner = new LightweightAgentRunner({ db, executeAgentLoop: execute });

    await runner.run({
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

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1]?.[0]?.userInput).toContain('$.result is required');
  });

  it('returns contract_failed when repair still fails', async () => {
    const runner = new LightweightAgentRunner({
      db,
      executeAgentLoop: vi.fn(async () => ({ text: 'still bad', messages: [], usage: { totalTokens: 7 } })),
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
    expect(result.usage).toEqual({ totalTokens: 14 });
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

  it('fails future output contracts before calling the model', async () => {
    const execute = vi.fn();
    const runner = new LightweightAgentRunner({ db, executeAgentLoop: execute });

    const result = await runner.run({
      owner: { type: 'workflow_run', id: 'run-1' },
      purpose: 'workflow.ai_prompt',
      llmProfileId: 'llm-1',
      cwd: '/tmp',
      systemPrompt: 'system',
      input: 'say done',
      toolset: { id: 'none' },
      outputContract: { type: 'text' } as never,
      context: { policy: 'none' },
      limits: { maxTurns: 2, timeoutMs: 1_000 },
      permissionMode: 'deny-external',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Unsupported lightweight agent output contract: text');
    expect(execute).not.toHaveBeenCalled();
  });

  it('fails fast for structured input arrays and never calls the executor', async () => {
    const execute = vi.fn();
    const runner = new LightweightAgentRunner({ db, executeAgentLoop: execute });

    const result = await runner.run({
      owner: { type: 'workflow_run', id: 'run-1' },
      purpose: 'workflow.ai_prompt',
      llmProfileId: 'llm-1',
      cwd: '/tmp',
      systemPrompt: 'system',
      input: [{ role: 'user', content: 'say done' }] as never,
      toolset: { id: 'none' },
      outputContract: { type: 'json', schema: { type: 'object' } },
      context: { policy: 'none' },
      limits: { maxTurns: 2, timeoutMs: 1_000 },
      permissionMode: 'deny-external',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Structured agent messages are not supported');
    expect(execute).not.toHaveBeenCalled();
  });

  it('replays workflow-thread context using context.maxEvents', async () => {
    const execute: AgentLoopExecutor = vi.fn(async () => ({
      text: '{"result":"done"}',
      messages: [],
    }));
    const runner = new LightweightAgentRunner({ db, executeAgentLoop: execute, now: () => 2_000 });

    await runner.run({
      owner: { type: 'workflow_run', id: 'run-1' },
      purpose: 'workflow.ai_prompt',
      llmProfileId: 'llm-1',
      cwd: '/tmp',
      systemPrompt: 'system',
      input: 'first run',
      toolset: { id: 'none' },
      outputContract: {
        type: 'json',
        schema: {
          type: 'object',
          required: ['result'],
          properties: { result: { type: 'string' } },
        },
      },
      context: { policy: 'workflow-thread', key: 'thread-1' },
      limits: { maxTurns: 2, timeoutMs: 1_000 },
      permissionMode: 'deny-external',
    });

    await runner.run({
      owner: { type: 'workflow_run', id: 'run-1' },
      purpose: 'workflow.ai_prompt',
      llmProfileId: 'llm-1',
      cwd: '/tmp',
      systemPrompt: 'system',
      input: 'second run',
      toolset: { id: 'none' },
      outputContract: {
        type: 'json',
        schema: {
          type: 'object',
          required: ['result'],
          properties: { result: { type: 'string' } },
        },
      },
      context: { policy: 'workflow-thread', key: 'thread-1', maxEvents: 2 },
      limits: { maxTurns: 2, timeoutMs: 1_000 },
      permissionMode: 'deny-external',
    });

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1]?.[0]?.userInput).toContain('assistant_message: {"text":"{\\"result\\":\\"done\\"}"}');
    expect(execute.mock.calls[1]?.[0]?.userInput).toContain('contract_result: {"result":"done"}');
    expect(execute.mock.calls[1]?.[0]?.userInput).not.toContain('input: {"purpose":"workflow.ai_prompt","input":"first run"}');
  });

  it('does not persist rendered workflow-thread context into later history', async () => {
    const execute: AgentLoopExecutor = vi.fn(async () => ({
      text: '{"result":"done"}',
      messages: [],
    }));
    const runner = new LightweightAgentRunner({ db, executeAgentLoop: execute, now: () => 2_000 });

    const request = (input: string) => runner.run({
      owner: { type: 'workflow_run', id: 'run-1' },
      purpose: 'workflow.ai_prompt',
      llmProfileId: 'llm-1',
      cwd: '/tmp',
      systemPrompt: 'system',
      input,
      toolset: { id: 'none' },
      outputContract: {
        type: 'json',
        schema: {
          type: 'object',
          required: ['result'],
          properties: { result: { type: 'string' } },
        },
      },
      context: { policy: 'workflow-thread', key: 'thread-1', maxEvents: 20 },
      limits: { maxTurns: 2, timeoutMs: 1_000 },
      permissionMode: 'deny-external',
    });

    await request('first run');
    await request('second run');
    await request('third run');

    const thirdInput = execute.mock.calls[2]?.[0]?.userInput ?? '';
    expect(thirdInput.match(/# Prior Agent Loop Context/g)).toHaveLength(1);
    expect(thirdInput).toContain('input: {"purpose":"workflow.ai_prompt","input":"second run"}');
    expect(thirdInput).not.toContain('"input":"# Prior Agent Loop Context');
  });

  it('allows declared permission-review tools and rejects undeclared ones', async () => {
    const execute: AgentLoopExecutor = vi.fn(async (input) => {
      const readDecision = await input.hooks.beforeToolCall?.({
        toolCall: { id: 'read-1', name: 'Read', arguments: { path: '/tmp/file.ts' } },
        args: { path: '/tmp/file.ts' },
      } as never);
      const writeDecision = await input.hooks.beforeToolCall?.({
        toolCall: { id: 'write-1', name: 'Write', arguments: { path: '/tmp/file.ts', content: 'x' } },
        args: { path: '/tmp/file.ts', content: 'x' },
      } as never);

      expect(readDecision).toBeUndefined();
      expect(writeDecision).toEqual({
        block: true,
        reason: 'Tool Write is not declared by permission-review',
      });

      return {
        text: '{"result":"done"}',
        messages: [],
      };
    });
    const runner = new LightweightAgentRunner({ db, executeAgentLoop: execute });

    const result = await runner.run({
      owner: { type: 'workflow_run', id: 'run-1' },
      purpose: 'workflow.ai_prompt',
      llmProfileId: 'llm-1',
      cwd: '/tmp',
      systemPrompt: 'system',
      input: 'say done',
      toolset: { id: 'permission-review' },
      outputContract: {
        type: 'json',
        schema: {
          type: 'object',
          required: ['result'],
          properties: { result: { type: 'string' } },
        },
      },
      context: { policy: 'none' },
      limits: { maxTurns: 2, timeoutMs: 1_000 },
      permissionMode: 'allow-declared-tools',
    });

    expect(result.status).toBe('completed');
    expect(execute).toHaveBeenCalledOnce();
  });

  it('fails permission modes that do not match the toolset descriptor', async () => {
    const execute = vi.fn();
    const runner = new LightweightAgentRunner({ db, executeAgentLoop: execute });

    const result = await runner.run({
      owner: { type: 'workflow_run', id: 'run-1' },
      purpose: 'workflow.ai_prompt',
      llmProfileId: 'llm-1',
      cwd: '/tmp',
      systemPrompt: 'system',
      input: 'say done',
      toolset: { id: 'permission-review' },
      outputContract: { type: 'json', schema: { type: 'object' } },
      context: { policy: 'none' },
      limits: { maxTurns: 2, timeoutMs: 1_000 },
      permissionMode: 'deny-external',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Permission mode deny-external does not match toolset permission-review');
    expect(execute).not.toHaveBeenCalled();
  });

  it('fails unsupported permission modes before calling the model', async () => {
    const execute = vi.fn();
    const runner = new LightweightAgentRunner({ db, executeAgentLoop: execute });

    const result = await runner.run({
      owner: { type: 'workflow_run', id: 'run-1' },
      purpose: 'workflow.ai_prompt',
      llmProfileId: 'llm-1',
      cwd: '/tmp',
      systemPrompt: 'system',
      input: 'say done',
      toolset: { id: 'permission-review' },
      outputContract: { type: 'json', schema: { type: 'object' } },
      context: { policy: 'none' },
      limits: { maxTurns: 2, timeoutMs: 1_000 },
      permissionMode: 'custom' as never,
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Unsupported lightweight agent permission mode: custom');
    expect(execute).not.toHaveBeenCalled();
  });
});
