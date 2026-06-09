import { describe, expect, it } from 'vitest';
import { computeMcpInstructionsDelta } from '../mcp.js';

describe('computeMcpInstructionsDelta', () => {
  it('announces connected MCP server instructions that were not announced before', () => {
    const delta = computeMcpInstructionsDelta(
      [
        { name: 'github', instructions: 'Use GitHub safely.' },
        { name: 'filesystem', instructions: 'Read local files.' },
      ],
      [],
      1234,
    );

    expect(delta).toEqual({
      addedNames: ['filesystem', 'github'],
      addedBlocks: ['## filesystem\nRead local files.', '## github\nUse GitHub safely.'],
      removedNames: [],
      createdAt: 1234,
    });
  });

  it('returns null when current instructions have already been announced', () => {
    const previous = [{
      addedNames: ['github'],
      addedBlocks: ['## github\nUse GitHub safely.'],
      removedNames: [],
      createdAt: 1000,
    }];

    expect(computeMcpInstructionsDelta(
      [{ name: 'github', instructions: 'Use GitHub safely.' }],
      previous,
      1234,
    )).toBeNull();
  });

  it('announces removals for previously announced servers that are no longer connected', () => {
    const delta = computeMcpInstructionsDelta(
      [{ name: 'filesystem', instructions: 'Read local files.' }],
      [{
        addedNames: ['filesystem', 'github'],
        addedBlocks: ['## filesystem\nRead local files.', '## github\nUse GitHub safely.'],
        removedNames: [],
        createdAt: 1000,
      }],
      1234,
    );

    expect(delta).toEqual({
      addedNames: [],
      addedBlocks: [],
      removedNames: ['github'],
      createdAt: 1234,
    });
  });

  it('allows a removed server to be announced again after reconnect', () => {
    const delta = computeMcpInstructionsDelta(
      [{ name: 'github', instructions: 'Use GitHub safely.' }],
      [
        {
          addedNames: ['github'],
          addedBlocks: ['## github\nUse GitHub safely.'],
          removedNames: [],
          createdAt: 1000,
        },
        {
          addedNames: [],
          addedBlocks: [],
          removedNames: ['github'],
          createdAt: 1100,
        },
      ],
      1234,
    );

    expect(delta?.addedNames).toEqual(['github']);
    expect(delta?.removedNames).toEqual([]);
  });
});
