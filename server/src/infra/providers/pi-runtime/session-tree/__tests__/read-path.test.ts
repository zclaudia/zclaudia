import { describe, it, expect } from 'vitest';
import { appendMessagesToTree } from '../write-path.js';
import { readRecentMessages } from '../read-path.js';
import { makeSessionDb } from './fixture.js';


const msg = (role: string, content: string) => ({ role, content }) as never;

describe('readRecentMessages', () => {
  it('returns [] for a session with no entries', async () => {
    expect(await readRecentMessages(makeSessionDb(), 's1', 16)).toEqual([]);
  });

  it('returns all messages (in root→leaf order) when fewer than the limit', async () => {
    const db = makeSessionDb();
    appendMessagesToTree(db, 's1', [msg('user', 'a'), msg('assistant', 'b'), msg('user', 'c')]);
    const out = (await readRecentMessages(db, 's1', 16)) as Array<{ role: string; content: string }>;
    expect(out.map(m => m.content)).toEqual(['a', 'b', 'c']);
  });

  it('returns only the most recent `limit` messages for a long session', async () => {
    const db = makeSessionDb();
    const many = Array.from({ length: 40 }, (_, i) =>
      msg(i % 2 === 0 ? 'user' : 'assistant', `m${i}`)
    );
    appendMessagesToTree(db, 's1', many);
    const out = (await readRecentMessages(db, 's1', 16)) as Array<{ content: string }>;
    expect(out).toHaveLength(16);
    expect(out[0].content).toBe('m24'); // 40 - 16
    expect(out[15].content).toBe('m39');
  });
});
