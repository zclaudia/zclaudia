import { describe, expect, it } from 'vitest';
import { resolvePluginPlatform, validatePluginManifest, type PluginManifest } from './manifest.js';

const baseManifest = {
  id: 'com.example.plugin',
  name: 'Example Plugin',
  version: '1.2.3',
  description: 'Example plugin manifest',
} satisfies PluginManifest;

describe('plugin manifest validation', () => {
  it('reports required fields, invalid ids, and semver warnings', () => {
    const result = validatePluginManifest({
      id: 'bad id',
      version: '1',
      description: '',
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'Invalid id format (use reverse domain notation, e.g., com.example.plugin)',
        'Missing required field: name',
        'Missing required field: description',
      ])
    );
    expect(result.warnings).toContain('Version should follow semver format (e.g., 1.0.0)');
  });

  it('validates malformed contribution entries without throwing', () => {
    const result = validatePluginManifest({
      ...baseManifest,
      contributes: {
        commands: [null],
        tools: [42],
        notchTabs: ['bad'],
        workflowSteps: [undefined],
        agentProfiles: [false],
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'Command contribution missing "command" field',
        'Command contribution missing "title" field',
        'Tool contribution missing "id" field',
        'Tool contribution missing "name" field',
        'Tool contribution missing "description" field',
        'NotchTab contribution missing "id" field',
        'NotchTab contribution missing "label" field',
        'WorkflowStep contribution missing "id" field',
        'WorkflowStep contribution missing "name" field',
        'WorkflowStep contribution missing "description" field',
        'AgentProfile contribution missing "id" field',
        'AgentProfile contribution missing "name" field',
      ])
    );
  });

  it('infers desktop platform from UI contributions and frontend entries', () => {
    expect(resolvePluginPlatform({ ...baseManifest })).toBe('universal');
    expect(
      resolvePluginPlatform({
        ...baseManifest,
        contributes: {
          tools: [
            {
              id: 'tool-1',
              name: 'Tool',
              description: 'Backend tool',
              parameters: {},
            },
          ],
        },
      })
    ).toBe('universal');
    expect(
      resolvePluginPlatform({
        ...baseManifest,
        contributes: {
          panels: [{ id: 'panel-1', label: 'Panel', location: 'sidebar' }],
        },
      })
    ).toBe('desktop');
    expect(resolvePluginPlatform({ ...baseManifest, frontend: 'dist/frontend.js' })).toBe(
      'desktop'
    );
  });
});
