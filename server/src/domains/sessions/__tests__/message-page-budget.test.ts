import { describe, it, expect } from 'vitest';
import { applyMessagePageBudget } from '../message-page-budget.js';

function msg(bytes: number): { content: string; metadata: string | null } {
  return { content: 'x'.repeat(bytes), metadata: null };
}

describe('applyMessagePageBudget', () => {
  it('returns all messages when under the byte budget', () => {
    const messages = [msg(100), msg(100), msg(100)];
    const { trimmed, wasTrimmed } = applyMessagePageBudget(messages, 10_000, 10);
    expect(trimmed).toHaveLength(3);
    expect(wasTrimmed).toBe(false);
  });

  it('trims the tail once over budget AND past the minimum count', () => {
    // 20 messages of 200 bytes; budget 1000, min 3. Crosses 1000 at index 5.
    const messages = Array.from({ length: 20 }, () => msg(200));
    const { trimmed, wasTrimmed } = applyMessagePageBudget(messages, 1000, 3);
    expect(trimmed).toHaveLength(5);
    expect(wasTrimmed).toBe(true);
  });

  it('a single oversized message does NOT collapse the page below the minimum', () => {
    // The regression: one fat message used to cut the page to 1-2 items.
    const messages = Array.from({ length: 12 }, (_, i) => (i === 2 ? msg(5_000) : msg(50)));
    const { trimmed, wasTrimmed } = applyMessagePageBudget(messages, 1000, 10);
    expect(trimmed).toHaveLength(10);
    expect(wasTrimmed).toBe(true);
  });

  it('returns everything when there are fewer messages than the minimum, even over budget', () => {
    const messages = [msg(50), msg(900_000)];
    const { trimmed, wasTrimmed } = applyMessagePageBudget(messages, 1000, 10);
    expect(trimmed).toHaveLength(2);
    expect(wasTrimmed).toBe(false);
  });

  it('counts both content and metadata length toward the budget', () => {
    const messages = [
      { content: 'a'.repeat(300), metadata: 'b'.repeat(300) }, // 600
      { content: 'a'.repeat(300), metadata: 'b'.repeat(300) }, // 1200 cum
      { content: 'c', metadata: null },
    ];
    const { trimmed } = applyMessagePageBudget(messages, 1000, 1);
    expect(trimmed).toHaveLength(1);
  });
});
