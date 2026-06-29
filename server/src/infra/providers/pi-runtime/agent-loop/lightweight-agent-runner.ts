import type Database from 'better-sqlite3';
import {
  AgentLoopContextRepository,
  buildJsonRepairPrompt,
  parseJsonOutput,
  type AgentLoopEvent,
  type AgentLoopRunnerPort,
  type LightweightAgentRunRequest,
  type LightweightAgentRunResult,
} from '../../../../domains/agent-loop/index.js';
import { LlmProfileRepository } from '../../../../domains/llm-profiles/repository.js';
import { buildAgentHooks } from '../agent-hooks.js';
import { buildModel } from '../build-model.js';
import { AgentLoopTimeoutError, runPiAgentLoop, type AgentLoopExecutor } from './pi-agent-loop-executor.js';
import { buildAgentLoopTools, getAgentLoopToolsetDescriptor } from './toolsets.js';

export type { AgentLoopExecutor } from './pi-agent-loop-executor.js';

export interface LightweightAgentRunnerDeps {
  db: Database.Database;
  executeAgentLoop?: AgentLoopExecutor;
  now?: () => number;
}

export class LightweightAgentRunner implements AgentLoopRunnerPort {
  private readonly contextRepository: AgentLoopContextRepository;
  private readonly llmProfileRepository: LlmProfileRepository;
  private readonly executeAgentLoop: AgentLoopExecutor;

  constructor(private readonly deps: LightweightAgentRunnerDeps) {
    this.contextRepository = new AgentLoopContextRepository(deps.db, { now: deps.now });
    this.llmProfileRepository = new LlmProfileRepository(deps.db);
    this.executeAgentLoop = deps.executeAgentLoop ?? runPiAgentLoop;
  }

  async run(request: LightweightAgentRunRequest): Promise<LightweightAgentRunResult> {
    const resolvedContext = this.contextRepository.resolveContextForRun({
      owner: request.owner,
      policy: request.context.policy,
      key: request.context.key,
      maxEvents: request.context.maxEvents,
    });

    try {
      const currentInput = validateInput(request.input);

      if (request.outputContract.type !== 'json') {
        throw new Error(`Unsupported lightweight agent output contract: ${request.outputContract.type}`);
      }

      const descriptor = getAgentLoopToolsetDescriptor(request.toolset.id);
      if (!descriptor) {
        throw new Error(`Unknown agent-loop toolset: ${request.toolset.id}`);
      }

      const llmProfile = request.llmProfileId
        ? this.llmProfileRepository.findById(request.llmProfileId)
        : this.llmProfileRepository.findDefault();
      if (!llmProfile) {
        throw new Error('No LLM profile configured for lightweight agent run');
      }

      const modelEntry = request.model
        ? llmProfile.models?.find((entry) => entry.modelId === request.model)
        : undefined;
      const modelInfo = buildModel(llmProfile, request.model, modelEntry);
      const tools = buildAgentLoopTools({
        cwd: request.cwd,
        toolsetId: request.toolset.id,
        overrides: request.toolset.overrides,
        db: this.deps.db,
      });
      const hooks = buildAgentHooks({
        permissionCallback: async (permissionRequest) => {
          if (request.permissionMode === 'deny-external') {
            return { behavior: 'deny', message: 'Lightweight agent run does not allow external tools' } as const;
          }

          if (!descriptor.tools.includes(permissionRequest.toolName as never)) {
            return {
              behavior: 'deny',
              message: `Tool ${permissionRequest.toolName} is not declared by ${descriptor.id}`,
            } as const;
          }

          return { behavior: 'allow' } as const;
        },
        cwd: request.cwd,
        sessionId: resolvedContext.contextId,
      });

      const renderedInput = renderInput(currentInput, resolvedContext.loadedEvents);
      this.contextRepository.appendEvent({
        contextId: resolvedContext.contextId,
        kind: 'input',
        payload: {
          purpose: request.purpose,
          input: renderedInput,
        },
      });

      let latestText = '';
      const maxAttempts = (request.outputContract.repairAttempts ?? 0) + 1;

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const agentResult = await this.executeAgentLoop({
          systemPrompt: request.systemPrompt,
          userInput: attempt === 0
            ? renderedInput
            : buildJsonRepairPrompt(latestText, [parseJsonOutput(latestText, request.outputContract).error]),
          history: [],
          modelInfo,
          tools,
          hooks,
          timeoutMs: request.limits.timeoutMs,
          maxTurns: request.limits.maxTurns,
          sessionId: resolvedContext.contextId,
          cacheRetention: llmProfile.cacheRetention,
        });

        latestText = agentResult.text;
        this.contextRepository.appendEvent({
          contextId: resolvedContext.contextId,
          kind: 'assistant_message',
          payload: { text: latestText },
        });

        const parsed = parseJsonOutput(latestText, request.outputContract);
        if (parsed.ok) {
          this.contextRepository.appendEvent({
            contextId: resolvedContext.contextId,
            kind: 'contract_result',
            payload: parsed.output,
          });
          return {
            status: 'completed',
            output: parsed.output,
            usage: agentResult.usage,
            traceId: resolvedContext.contextId,
            contextId: resolvedContext.contextId,
          };
        }

        if (attempt === maxAttempts - 1) {
          this.contextRepository.appendEvent({
            contextId: resolvedContext.contextId,
            kind: 'error',
            payload: { error: parsed.error, status: 'contract_failed' },
          });
          return {
            status: 'contract_failed',
            output: {},
            traceId: resolvedContext.contextId,
            contextId: resolvedContext.contextId,
            error: parsed.error,
          };
        }
      }

      return {
        status: 'contract_failed',
        output: {},
        traceId: resolvedContext.contextId,
        contextId: resolvedContext.contextId,
        error: 'JSON contract failed',
      };
    } catch (error) {
      const status = error instanceof AgentLoopTimeoutError ? 'timeout' : 'failed';
      const message = error instanceof Error ? error.message : String(error);
      this.contextRepository.appendEvent({
        contextId: resolvedContext.contextId,
        kind: 'error',
        payload: {
          status,
          error: message,
        },
      });
      return {
        status,
        output: {},
        traceId: resolvedContext.contextId,
        contextId: resolvedContext.contextId,
        error: message,
      };
    }
  }
}

function renderInput(currentInput: string, loadedEvents: AgentLoopEvent[]): string {
  if (loadedEvents.length === 0) {
    return currentInput;
  }

  const renderedHistory = loadedEvents
    .map((event) => `${event.kind}: ${JSON.stringify(event.payload)}`)
    .join('\n');

  return `# Prior Agent Loop Context\n${renderedHistory}\n\n# Current Input\n${currentInput}`;
}

function validateInput(input: unknown): string {
  if (typeof input === 'string') {
    return input;
  }

  throw new Error('Structured agent messages are not supported by LightweightAgentRunner; pass a plain string input.');
}
