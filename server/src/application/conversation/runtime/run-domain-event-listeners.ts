import {
  isPublicRunDomainEventType,
  type PublicRunDomainEventType,
  type RunDomainEvent,
  type RunDomainEventType,
} from './run-domain-events.js';

export type RunDomainEventListener<
  TType extends PublicRunDomainEventType = PublicRunDomainEventType,
> = (event: Extract<RunDomainEvent, { type: TType }>) => void | Promise<void>;

type AnyRunDomainEventListener = (event: RunDomainEvent) => void | Promise<void>;

export interface RunDomainEventListenerRegistryOptions {
  onListenerError?: (error: unknown, event: RunDomainEvent) => void;
}

export class RunDomainEventListenerRegistry {
  private readonly listeners = new Map<PublicRunDomainEventType, Set<AnyRunDomainEventListener>>();
  private readonly onListenerError: (error: unknown, event: RunDomainEvent) => void;

  constructor(options: RunDomainEventListenerRegistryOptions = {}) {
    this.onListenerError =
      options.onListenerError ??
      ((error, event) => {
        console.warn('[RunDomainEventListeners] listener failed:', {
          eventType: event.type,
          error: error instanceof Error ? error.message : error,
        });
      });
  }

  on<TType extends PublicRunDomainEventType>(
    type: TType,
    listener: RunDomainEventListener<TType>
  ): () => void {
    if (!isPublicRunDomainEventType(type as RunDomainEventType)) {
      throw new Error(`"${type}" is not a public run domain event`);
    }

    const storedListener = listener as unknown as AnyRunDomainEventListener;
    const listenersForType = this.listeners.get(type) ?? new Set<AnyRunDomainEventListener>();
    listenersForType.add(storedListener);
    this.listeners.set(type, listenersForType);

    return () => {
      listenersForType.delete(storedListener);
      if (listenersForType.size === 0) {
        this.listeners.delete(type);
      }
    };
  }

  emit(event: RunDomainEvent): void {
    if (!isPublicRunDomainEventType(event.type)) return;

    const listeners = [...(this.listeners.get(event.type) ?? [])];
    for (const listener of listeners) {
      try {
        const result = listener(event);
        if (result && typeof result === 'object' && 'then' in result) {
          result.catch((error: unknown) => this.onListenerError(error, event));
        }
      } catch (error) {
        this.onListenerError(error, event);
      }
    }
  }
}

export const runDomainEventListeners = new RunDomainEventListenerRegistry();
