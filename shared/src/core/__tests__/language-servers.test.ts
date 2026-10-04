import { describe, expect, it } from 'vitest';
import {
  validateLanguageServerConfig,
  validateLanguageServerConfigs,
} from '../language-servers.js';
import { validatePluginManifest } from '../../plugins/manifest.js';

const clangd = {
  id: 'clangd',
  name: ' C (clangd) ',
  command: 'clangd',
  extensions: { '.C': 'c', '.h': 'c' },
  rootMarkers: ['compile_commands.json'],
};

describe('validateLanguageServerConfig', () => {
  it('accepts a definition and normalizes it', () => {
    expect(validateLanguageServerConfig(clangd)).toEqual({
      ok: true,
      config: {
        id: 'clangd',
        name: 'C (clangd)',
        command: 'clangd',
        extensions: { '.c': 'c', '.h': 'c' },
        rootMarkers: ['compile_commands.json'],
      },
    });
  });

  it('names every problem', () => {
    const result = validateLanguageServerConfig({
      id: 'Has Spaces',
      name: '',
      command: './bin/x',
      args: [1],
      extensions: { c: 'c' },
      rootMarkers: [],
      settings: 'no',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([
        expect.stringContaining('id must be'),
        'name is required',
        'command must be an absolute path or a name on PATH',
        'args must be a list of strings',
        expect.stringContaining('extension "c" must start with a dot'),
        expect.stringContaining('rootMarkers'),
        'settings must be an object',
      ]);
    }
  });

  it('allows ./ commands only where asked (plugins)', () => {
    expect(
      validateLanguageServerConfig(
        { ...clangd, command: './bin/clangd' },
        { allowRelativeCommand: true }
      ).ok
    ).toBe(true);
  });

  it('rejects duplicate ids in a list', () => {
    const result = validateLanguageServerConfigs([clangd, clangd]);
    expect(result).toEqual({ ok: false, errors: ['servers[1]: duplicate id "clangd"'] });
  });

  it('checks contributes.lspServers in a plugin manifest', () => {
    const manifest = {
      id: 'com.example.c',
      name: 'C',
      version: '1.0.0',
      description: 'C support',
      contributes: { lspServers: [{ ...clangd, command: './bin/clangd' }, { id: 'x' }] },
    };
    const result = validatePluginManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some(error => error.startsWith('contributes.lspServers[1]:'))).toBe(true);
  });
});
