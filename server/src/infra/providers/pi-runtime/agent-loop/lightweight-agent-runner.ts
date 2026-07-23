import type Database from 'better-sqlite3';
import {
  AgentLoopContextRepository,
  buildJsonContractPrompt,
  buildJsonRepairPrompt,
  parseJsonOutput,
  type AgentLoopEvent,
  type AgentLoopPermissionMode,
  type AgentLoopRunnerPort,
  type JsonOutputContract,
  type LightweightAgentRunRequest,
  type LightweightAgentRunResult,
} from '../../../../domains/agent-loop/index.js';
import { LlmProfileRepository } from '../../../../domains/llm-profiles/repository.js';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import { buildAgentHooks } from '../agent-hooks.js';
import { PendingArgOverrides } from '../pending-arg-overrides.js';
import { buildModel } from '../build-model.js';
import {
  AgentLoopTimeoutError,
  runPiAgentLoop,
  type AgentLoopExecutor,
} from './pi-agent-loop-executor.js';
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
    let accumulatedUsage: Record<string, unknown> | undefined;
    const resolvedContext = this.contextRepository.resolveContextForRun({
      owner: request.owner,
      policy: request.context.policy,
      key: request.context.key,
      maxEvents: request.context.maxEvents,
    });

    try {
      const currentInput = validateInput(request.input);
      const outputContract = validateJsonOutputContract(request.outputContract);
      const permissionMode = validatePermissionMode(request.permissionMode);

      const descriptor = getAgentLoopToolsetDescriptor(request.toolset.id);
      if (!descriptor) {
        throw new Error(`Unknown agent-loop toolset: ${request.toolset.id}`);
      }
      if (permissionMode !== descriptor.permissionMode) {
        throw new Error(
          `Permission mode ${permissionMode} does not match toolset ${descriptor.id} (${descriptor.permissionMode})`
        );
      }

      const llmProfile = request.llmProfileId
        ? this.llmProfileRepository.findById(request.llmProfileId)
        : this.llmProfileRepository.findDefault();
      if (!llmProfile) {
        throw new Error('No LLM profile configured for lightweight agent run');
      }

      const modelOverride = resolveModelOverride(llmProfile, request.model);
      const modelEntry = modelOverride
        ? llmProfile.models?.find(entry => entry.modelId === modelOverride)
        : undefined;
      const modelInfo = buildModel(llmProfile, modelOverride, modelEntry);
      const runtimePermissionCallback = request.permissions?.permissionCallback;
      const permissionCallback = async (
        permissionRequest: Parameters<NonNullable<typeof runtimePermissionCallback>>[0]
      ) => {
        if (permissionMode === 'deny-external') {
          return {
            behavior: 'deny',
            message: 'Lightweight agent run does not allow external tools',
          } as const;
        }

        const declaredPermissionTools = descriptor.permissionTools ?? [];
        if (
          !descriptor.tools.includes(permissionRequest.toolName as never) &&
          !declaredPermissionTools.includes(permissionRequest.toolName)
        ) {
          return {
            behavior: 'deny',
            message: `Tool ${permissionRequest.toolName} is not declared by ${descriptor.id}`,
          } as const;
        }

        if (runtimePermissionCallback) {
          return runtimePermissionCallback(permissionRequest);
        }

        return { behavior: 'allow' } as const;
      };
      // One store per run: carries permission-approved updatedInput rewrites
      // from the beforeToolCall hook into the wrapped tool executes (pi-agent-core
      // drops `{ args }` from BeforeToolCallResult).
      const argOverrides = new PendingArgOverrides();
      const tools = buildAgentLoopTools({
        cwd: request.cwd,
        toolsetId: request.toolset.id,
        overrides: request.toolset.overrides,
        db: this.deps.db,
        permissionCallback,
        sessionId: request.permissions?.toolSessionId,
        runId: request.owner.id,
        argOverrides,
      });
      const hooks = buildAgentHooks({
        permissionCallback,
        userHooks: request.permissions?.userHooks,
        cwd: request.cwd,
        sessionId: resolvedContext.contextId,
        argOverrides,
        // P1-10: forward the caller's abort signal so shouldStopAfterTurn's
        // abort check is live and hook processes die with the run.
        abortSignal: request.abortSignal,
      });

      const renderedInput = renderInput(currentInput, resolvedContext.loadedEvents);
      const contractedInput = buildJsonContractPrompt(renderedInput, outputContract);
      this.contextRepository.appendEvent({
        contextId: resolvedContext.contextId,
        kind: 'input',
        payload: {
          purpose: request.purpose,
          input: currentInput,
        },
      });

      let latestText = '';
      let latestParseError = 'JSON contract failed';
      const maxAttempts = (outputContract.repairAttempts ?? 0) + 1;

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const agentResult = await this.executeAgentLoop({
          systemPrompt: request.systemPrompt,
          userInput:
            attempt === 0
              ? contractedInput
              : buildJsonRepairPrompt(latestText, [latestParseError], outputContract),
          history: [],
          modelInfo,
          tools,
          hooks,
          timeoutMs: request.limits.timeoutMs,
          maxTurns: request.limits.maxTurns,
          sessionId: resolvedContext.contextId,
          cacheRetention: llmProfile.cacheRetention,
          // P2: forward the caller's abort signal into the executor so an
          // external abort cancels the in-flight LLM stream, not just hooks.
          signal: request.abortSignal,
        });

        latestText = agentResult.text;
        accumulatedUsage = accumulateUsage(accumulatedUsage, agentResult.usage);
        this.contextRepository.appendEvent({
          contextId: resolvedContext.contextId,
          kind: 'assistant_message',
          payload: { text: latestText },
        });

        const parsed = parseJsonOutput(latestText, outputContract);
        if (parsed.ok) {
          this.contextRepository.appendEvent({
            contextId: resolvedContext.contextId,
            kind: 'contract_result',
            payload: parsed.output,
          });
          return {
            status: 'completed',
            output: parsed.output,
            usage: accumulatedUsage,
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
            usage: accumulatedUsage,
            traceId: resolvedContext.contextId,
            contextId: resolvedContext.contextId,
            error: parsed.error,
          };
        }

        latestParseError = parsed.error;
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
        usage: accumulatedUsage,
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
    .map(event => `${event.kind}: ${JSON.stringify(event.payload)}`)
    .join('\n');

  return `# Prior Agent Loop Context\n${renderedHistory}\n\n# Current Input\n${currentInput}`;
}

function validateInput(input: unknown): string {
  if (typeof input === 'string') {
    return input;
  }

  throw new Error(
    'Structured agent messages are not supported by LightweightAgentRunner; pass a plain string input.'
  );
}

function resolveModelOverride(
  profile: LlmProfileConfig,
  requestModel: string | undefined
): string | undefined {
  if (requestModel) {
    return requestModel;
  }

  return profile.models?.[0]?.modelId;
}

function validateJsonOutputContract(contract: unknown): JsonOutputContract {
  if (isRecord(contract) && contract.type === 'json') {
    return contract as JsonOutputContract;
  }

  const type = isRecord(contract) && typeof contract.type === 'string' ? contract.type : 'unknown';
  throw new Error(`Unsupported lightweight agent output contract: ${type}`);
}

function validatePermissionMode(mode: unknown): AgentLoopPermissionMode {
  if (mode === 'deny-external' || mode === 'allow-declared-tools') {
    return mode;
  }

  const rendered = typeof mode === 'string' ? mode : 'unknown';
  throw new Error(`Unsupported lightweight agent permission mode: ${rendered}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function accumulateUsage(
  current: Record<string, unknown> | undefined,
  next: unknown
): Record<string, unknown> | undefined {
  if (!isRecord(next)) {
    return current;
  }

  return addNumericUsage(current ?? {}, next);
}

function addNumericUsage(
  current: Record<string, unknown>,
  next: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(next)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      const previous = typeof result[key] === 'number' ? result[key] : 0;
      result[key] = previous + value;
    } else if (isRecord(value)) {
      result[key] = addNumericUsage(isRecord(result[key]) ? result[key] : {}, value);
    }
  }
  return result;
}
