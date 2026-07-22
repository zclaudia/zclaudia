/**
 * Shared bounded reader for fetch Response bodies (P1-16).
 *
 * Both agent_http_request and agent_browser previously risked buffering an
 * unbounded response into memory (browser.ts called response.text() on the
 * whole body before slicing). This reader streams the body and stops as soon
 * as `maxBytes` have been collected, aborting the request (or cancelling the
 * reader) so multi-MB responses never reach the heap in full.
 */
export async function readResponseBodyWithBudget(
  response: Response,
  maxBytes: number,
  abort?: () => void
): Promise<{ text: string; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) {
    // Fallback for environments (and test doubles) without a streamable body.
    const text = typeof response.text === 'function' ? await response.text() : '';
    return text.length > maxBytes
      ? { text: text.slice(0, maxBytes), truncated: true }
      : { text, truncated: false };
  }

  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = '';
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    if (bytesRead > maxBytes) {
      const keep = Math.max(maxBytes - (bytesRead - value.byteLength), 0);
      text += decoder.decode(value.slice(0, keep), { stream: false });
      truncated = true;
      if (abort) {
        abort();
      } else {
        await reader.cancel().catch(() => {});
      }
      break;
    }
    text += decoder.decode(value, { stream: true });
  }
  return { text, truncated };
}
