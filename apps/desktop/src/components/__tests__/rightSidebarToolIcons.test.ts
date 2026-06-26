import { describe, it, expect } from 'vitest';
import { Terminal as TerminalIcon } from 'lucide-react';
import { iconForPanel } from '../rightSidebarToolIcons';

describe('iconForPanel', () => {
  it('maps a known panel id to its lucide icon', () => {
    expect(iconForPanel('terminal')).toBe(TerminalIcon);
  });
  it('returns a fallback for an unknown panel id', () => {
    expect(iconForPanel('totally-unknown')).toBeTruthy();
  });
});
