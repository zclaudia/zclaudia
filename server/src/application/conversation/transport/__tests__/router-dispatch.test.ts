import { describe, expect, it, vi } from 'vitest';
import { routeOrFallback } from '../router-dispatch.js';

describe('routeOrFallback', () => {
  it('runs fallback only when the router misses', async () => {
    const fallback = vi.fn();
    const sendResponse = vi.fn();
    const sendRouteError = vi.fn();

    await routeOrFallback({
      route: async () => null,
      fallback,
      sendResponse,
      sendRouteError,
    });

    expect(fallback).toHaveBeenCalledOnce();
    expect(sendResponse).not.toHaveBeenCalled();
    expect(sendRouteError).not.toHaveBeenCalled();
  });

  it('sends a structured error and does not fallback when the router throws', async () => {
    const fallback = vi.fn();
    const sendResponse = vi.fn();
    const sendRouteError = vi.fn();
    const error = new Error('router failed');

    await routeOrFallback({
      route: async () => {
        throw error;
      },
      fallback,
      sendResponse,
      sendRouteError,
    });

    expect(fallback).not.toHaveBeenCalled();
    expect(sendResponse).not.toHaveBeenCalled();
    expect(sendRouteError).toHaveBeenCalledWith(error);
  });
});
