import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { validatePluginManifest } from '@zclaudia/shared/plugins';

const pluginsDir = path.resolve(__dirname, '../../../../../plugins/agents');

// Capability tiers decided in docs/reviews/2026-10-16-{codex,cursor}-additional-directories-spike.md.
describe('built-in agent plugin additionalDirectories descriptors', () => {
  it.each([
    ['claude', 'native'],
    ['codex', 'native'],
    ['cursor', 'host'],
  ])('%s declares %s', (name, expected) => {
    const manifest = JSON.parse(readFileSync(path.join(pluginsDir, name, 'plugin.json'), 'utf8'));
    expect(manifest.contributes.agentRuntimes[0].additionalDirectories).toBe(expected);
    expect(validatePluginManifest(manifest).errors).toEqual([]);
  });
});
