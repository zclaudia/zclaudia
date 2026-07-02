export interface RouteOrFallbackOptions<TResponse> {
  route: () => Promise<TResponse | null | undefined>;
  fallback: () => Promise<void>;
  sendResponse: (response: TResponse) => void;
  sendRouteError: (error: unknown) => void;
}

export async function routeOrFallback<TResponse>({
  route,
  fallback,
  sendResponse,
  sendRouteError,
}: RouteOrFallbackOptions<TResponse>): Promise<'routed' | 'fallback' | 'error'> {
  try {
    const response = await route();
    if (response) {
      sendResponse(response);
      return 'routed';
    }
  } catch (error) {
    sendRouteError(error);
    return 'error';
  }

  await fallback();
  return 'fallback';
}
