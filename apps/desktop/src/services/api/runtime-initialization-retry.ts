function waitForStartup(signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, 1000);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
}

/** Keep the resolved backend fixed while its startup catalog becomes ready. */
export async function fetchWithRuntimeInitializationRetry(
  url: string,
  options?: RequestInit
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, options);
    if (
      attempt >= 10 ||
      (options?.method ?? 'GET').toUpperCase() !== 'GET' ||
      response.status !== 503
    )
      return response;
    const body = await response
      .clone()
      .json()
      .catch(() => null);
    if (body?.error?.code !== 'RUNTIMES_INITIALIZING') return response;
    await waitForStartup(options?.signal);
  }
}
