import type { LanguageServerConfig } from '@zclaudia/shared/core/language-servers';

/** Editable text form of a custom language-server definition. */
export interface CustomServerDraft {
  id: string;
  name: string;
  command: string;
  args: string;
  extensions: string;
  rootMarkers: string;
  initializationOptions: string;
  settings: string;
}

export const EMPTY_DRAFT: CustomServerDraft = {
  id: '',
  name: '',
  command: '',
  args: '',
  extensions: '',
  rootMarkers: '',
  initializationOptions: '',
  settings: '',
};

/** Ids of the servers that ship with the app: reusing one replaces it. */
export const BUILT_IN_SERVER_IDS = ['typescript', 'pyright', 'gopls', 'rust-analyzer'];

function words(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map(word => word.trim())
    .filter(Boolean);
}

/** A slug for a new server's id, from its name. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, 64);
}

/** `.c=c .cpp=cpp .lua` ⇄ { ".c": "c", ".cpp": "cpp", ".lua": "lua" }. */
export function parseExtensions(text: string): Record<string, string> {
  const extensions: Record<string, string> = {};
  for (const word of words(text)) {
    const [rawExt, rawLang] = word.split('=');
    const ext = rawExt.startsWith('.') ? rawExt : `.${rawExt}`;
    extensions[ext.toLowerCase()] = (rawLang || ext.slice(1)).trim();
  }
  return extensions;
}

export function formatExtensions(extensions: Record<string, string>): string {
  return Object.entries(extensions)
    .map(([ext, lang]) => (lang === ext.slice(1) ? ext : `${ext}=${lang}`))
    .join(' ');
}

function parseJson(text: string, field: string): { value?: unknown; error?: string } {
  if (!text.trim()) return {};
  try {
    return { value: JSON.parse(text) };
  } catch {
    return { error: `${field} must be valid JSON` };
  }
}

export function draftFromConfig(config: LanguageServerConfig): CustomServerDraft {
  return {
    id: config.id,
    name: config.name,
    command: config.command,
    args: (config.args ?? []).join(' '),
    extensions: formatExtensions(config.extensions),
    rootMarkers: config.rootMarkers.join(' '),
    initializationOptions:
      config.initializationOptions !== undefined
        ? JSON.stringify(config.initializationOptions, null, 2)
        : '',
    settings: config.settings ? JSON.stringify(config.settings, null, 2) : '',
  };
}

/**
 * The definition a draft describes, or the problems with it. The backend
 * validates again; this catches what the form itself can tell.
 */
export function configFromDraft(
  draft: CustomServerDraft
): { config: LanguageServerConfig; errors?: undefined } | { errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const id = draft.id.trim() || slugify(draft.name);
  if (!draft.name.trim()) errors.name = 'Name is required';
  if (!id) errors.id = 'Id is required';
  if (!draft.command.trim()) errors.command = 'Command is required';
  const extensions = parseExtensions(draft.extensions);
  if (Object.keys(extensions).length === 0) errors.extensions = 'Add at least one extension';
  const rootMarkers = words(draft.rootMarkers);
  if (rootMarkers.length === 0) errors.rootMarkers = 'Add at least one root marker file';
  const initializationOptions = parseJson(draft.initializationOptions, 'Initialization options');
  if (initializationOptions.error) errors.initializationOptions = initializationOptions.error;
  const settings = parseJson(draft.settings, 'Settings');
  if (settings.error) errors.settings = settings.error;
  else if (
    settings.value !== undefined &&
    (typeof settings.value !== 'object' || settings.value === null || Array.isArray(settings.value))
  ) {
    errors.settings = 'Settings must be a JSON object';
  }
  if (Object.keys(errors).length > 0) return { errors };
  // Arguments split on whitespace only: flags may contain commas.
  const args = draft.args.split(/\s+/).filter(Boolean);
  return {
    config: {
      id,
      name: draft.name.trim(),
      command: draft.command.trim(),
      ...(args.length > 0 ? { args } : {}),
      extensions,
      rootMarkers,
      ...(initializationOptions.value !== undefined
        ? { initializationOptions: initializationOptions.value }
        : {}),
      ...(settings.value !== undefined
        ? { settings: settings.value as Record<string, unknown> }
        : {}),
    },
  };
}
