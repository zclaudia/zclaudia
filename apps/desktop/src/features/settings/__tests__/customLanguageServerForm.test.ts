import { describe, expect, it } from 'vitest';
import {
  EMPTY_DRAFT,
  configFromDraft,
  draftFromConfig,
  formatExtensions,
  parseExtensions,
  slugify,
} from '../customLanguageServerForm';

describe('customLanguageServerForm', () => {
  it('reads extensions with optional language ids, and writes them back', () => {
    const extensions = parseExtensions('.c .CPP=cpp, h=c lua');
    expect(extensions).toEqual({ '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.lua': 'lua' });
    expect(formatExtensions(extensions)).toBe('.c .cpp .h=c .lua');
  });

  it('derives an id from the name', () => {
    expect(slugify('C / C++ (clangd)')).toBe('c-c-clangd');
  });

  it('turns a draft into a definition, and back', () => {
    const result = configFromDraft({
      ...EMPTY_DRAFT,
      name: 'C (clangd)',
      command: ' clangd ',
      args: '--background-index --query-driver=/usr/bin/gcc,/usr/bin/g++',
      extensions: '.c .h=c',
      rootMarkers: 'compile_commands.json, .clangd',
      settings: '{"clangd": {"fallbackFlags": ["-std=c11"]}}',
    });
    expect(result.errors).toBeUndefined();
    const config = result.errors ? undefined : result.config;
    expect(config).toEqual({
      id: 'c-clangd',
      name: 'C (clangd)',
      command: 'clangd',
      args: ['--background-index', '--query-driver=/usr/bin/gcc,/usr/bin/g++'],
      extensions: { '.c': 'c', '.h': 'c' },
      rootMarkers: ['compile_commands.json', '.clangd'],
      settings: { clangd: { fallbackFlags: ['-std=c11'] } },
    });
    expect(configFromDraft(draftFromConfig(config!))).toEqual({ config });
  });

  it('names what is missing or malformed', () => {
    const result = configFromDraft({ ...EMPTY_DRAFT, settings: '[1]', initializationOptions: '{' });
    expect(result.errors).toEqual({
      name: 'Name is required',
      id: 'Id is required',
      command: 'Command is required',
      extensions: 'Add at least one extension',
      rootMarkers: 'Add at least one root marker file',
      initializationOptions: 'Initialization options must be valid JSON',
      settings: 'Settings must be a JSON object',
    });
  });
});
