/**
 * Sentinel thrown from run-events' `case 'error'` when the provider rejected a
 * turn for exceeding the model context window. handleRunException recognizes it
 * and attempts a compaction + retry instead of failing the run outright.
 */
export class ContextOverflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContextOverflowError';
  }
}

// Lowercased substrings that reliably indicate a context-window overflow across
// Anthropic / OpenAI / OpenAI-compatible providers. Kept narrow to avoid
// misclassifying generic 400s as overflows (which would trigger pointless
// compaction). Extend with care + a test.
const OVERFLOW_SUBSTRINGS = [
  'prompt is too long',
  'context length',
  'context window',
  'maximum context',
  'context_length_exceeded',
  'too many tokens',
  'reduce the length of',
  'maximum context length',
  // Some openai-compatible proxies phrase context overflow as "exceeded model
  // token limit: <window> (requested: <n>)". Narrow enough to not catch
  // throughput/rate "token rate limit" messages (those lack "model token limit").
  'model token limit',
];

const OVERFLOW_CODES = new Set(['context_length_exceeded', '413']);

/**
 * Heuristic classifier on the provider's raw error string + optional machine
 * error code. Returns true only for context-window overflows.
 */
export function isContextOverflowError(raw: string, errorCode?: string): boolean {
  if (errorCode && OVERFLOW_CODES.has(errorCode.toLowerCase())) return true;
  const text = (raw || '').toLowerCase();
  return OVERFLOW_SUBSTRINGS.some(s => text.includes(s));
}
