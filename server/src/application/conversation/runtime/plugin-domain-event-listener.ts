import { pluginEvents } from '../../../infra/events/index.js';
import {
  PUBLIC_RUN_DOMAIN_EVENT_TYPES,
  type RunDomainEvent,
} from './run-domain-events.js';
import {
  runDomainEventListeners,
  type RunDomainEventListenerRegistry,
} from './run-domain-event-listeners.js';
import { projectRunDomainEventToPluginEvents } from './plugin-projector.js';

const registrations = new WeakMap<RunDomainEventListenerRegistry, () => void>();

export function registerPluginDomainEventListener(
  registry: RunDomainEventListenerRegistry = runDomainEventListeners,
): () => void {
  const existing = registrations.get(registry);
  if (existing) return existing;

  const unsubscribes = PUBLIC_RUN_DOMAIN_EVENT_TYPES.map(type =>
    registry.on(type, event => {
      emitProjectedPluginEvents(event as RunDomainEvent);
    }),
  );

  const unsubscribe = () => {
    for (const unsubscribeOne of unsubscribes.splice(0)) {
      unsubscribeOne();
    }
    registrations.delete(registry);
  };

  registrations.set(registry, unsubscribe);
  return unsubscribe;
}

function emitProjectedPluginEvents(event: RunDomainEvent): void {
  for (const projection of projectRunDomainEventToPluginEvents(event)) {
    pluginEvents.emit(projection.name, projection.payload).catch((err: unknown) => {
      console.warn('[PluginEvents] Event emission failed:', err instanceof Error ? err.message : err);
    });
  }
}
