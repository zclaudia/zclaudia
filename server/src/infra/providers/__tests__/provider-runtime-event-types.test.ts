import { describe, expect, expectTypeOf, it } from 'vitest';
import { PROVIDER_RUNTIME_EVENT_TYPES } from '../message-types.js';
import type { ProviderRuntimeEvent } from '../types.js';
import type {
  ProviderAssistantDeltaEvent,
  ProviderToolStartedEvent,
  ProviderTurnFinishedEvent,
} from '../message-types.js';

describe('ProviderRuntimeEvent types', () => {
  it('exports a runtime catalog for provider runtime event names', () => {
    expect(PROVIDER_RUNTIME_EVENT_TYPES).toEqual([
      'init',
      'assistant_delta',
      'tool_started',
      'tool_finished',
      'provider_turn_finished',
      'provider_error',
      'task_notification',
      'tool_activity',
      'mode_transition',
      'thinking_delta',
      'retry_scheduled',
    ]);
  });

  it('names provider adapter output as ProviderRuntimeEvent', () => {
    expectTypeOf<ProviderRuntimeEvent>().toMatchTypeOf<ProviderRuntimeEvent>();
  });

  it('uses explicit event variants for provider runtime signals', () => {
    expectTypeOf<ProviderAssistantDeltaEvent>().toMatchTypeOf<ProviderRuntimeEvent>();
    expectTypeOf<ProviderToolStartedEvent>().toMatchTypeOf<ProviderRuntimeEvent>();
    expectTypeOf<ProviderTurnFinishedEvent>().toMatchTypeOf<ProviderRuntimeEvent>();
  });
});
