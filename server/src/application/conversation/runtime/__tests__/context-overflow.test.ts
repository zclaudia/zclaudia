import { describe, it, expect } from 'vitest';
import { isContextOverflowError, ContextOverflowError } from '../context-overflow.js';

describe('isContextOverflowError', () => {
  it('matches Anthropic "prompt is too long"', () => {
    expect(isContextOverflowError('prompt is too long: 250000 tokens > 200000 maximum')).toBe(true);
  });
  it('matches OpenAI context_length_exceeded by code', () => {
    expect(isContextOverflowError('Bad request', 'context_length_exceeded')).toBe(true);
  });
  it('matches generic "maximum context length"', () => {
    expect(isContextOverflowError("This model's maximum context length is 128000 tokens")).toBe(true);
  });
  it('matches HTTP 413 code', () => {
    expect(isContextOverflowError('Payload too large', '413')).toBe(true);
  });
  it('does NOT match unrelated errors', () => {
    expect(isContextOverflowError('rate limit exceeded')).toBe(false);
    expect(isContextOverflowError('connection reset')).toBe(false);
    expect(isContextOverflowError('invalid api key', '401')).toBe(false);
  });
  it('is case-insensitive', () => {
    expect(isContextOverflowError('PROMPT IS TOO LONG')).toBe(true);
  });
});

describe('ContextOverflowError', () => {
  it('carries the formatted message and is instanceof Error', () => {
    const err = new ContextOverflowError('ctx too long');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ContextOverflowError');
    expect(err.message).toBe('ctx too long');
  });
});
