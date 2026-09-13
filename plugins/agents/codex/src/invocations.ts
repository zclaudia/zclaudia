import type {
  InvocableDescriptor,
  InvocableDiagnostic,
  InvocableScope,
  RuntimeDiscoveryContext,
  RuntimeInvocableCatalog,
  RuntimeInvocableRecord,
  RuntimeInvocationCapabilities,
} from '@zclaudia/plugin-sdk/invocations';
import { validateInvocationRegistration } from '@zclaudia/plugin-sdk/invocations';
import type { SkillsListEntry } from './app-server-protocol.js';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/**
 * URIP adapter for the Codex App Server (design doc §14.2, §29 step 5) —
 * the first real external runtime catalog, enabled by the §14.2 precondition
 * probe against the pinned CLI (0.154.0):
 *
 * - `skills/list` is cwd-scoped and returns name/description/path/scope/enabled
 *   per skill (verified live);
 * - `SkillsChangedNotification` is an invalidation signal to re-run
 *   `skills/list` (schema docstring);
 * - structured skill input is `SkillUserInput { type: "skill", name, path }` —
 *   both fields come from `skills/list`, never from user input.
 *
 * Truthfulness rules (§6.5, §9): skills are `runtime.skill` entries executed
 * `native-structured` with exact fidelity; host-materialized portable skills
 * are `unsupported` (Codex consumes only its own catalog); refresh is
 * `manual` because discovery rides the shared pooled app-server process
 * instead of a persistent skills/changed subscription.
 */

export interface CodexInvocationsDeps {
  /**
   * Returns a running app-server client for catalog discovery. The adapter's
   * shared pooled client keeps discovery cheap; no bridge config is created
   * for discovery-only use.
   */
  getClient: () => Promise<{
    listSkills(cwd: string): Promise<SkillsListEntry[]>;
  }>;
  /** Abortable delay seam for tests; defaults to not waiting. */
  raceSignal?: (signal: AbortSignal) => Promise<never>;
  /** File reader seam used to bind a catalog revision to skill content. */
  readFile?: (path: string) => Promise<string | Uint8Array>;
}

const SKILL_SCOPES: InvocableScope[] = ['session', 'project', 'user', 'system'];

function toInvocableScope(scope: string | null | undefined): InvocableScope {
  return SKILL_SCOPES.includes(scope as InvocableScope) ? (scope as InvocableScope) : 'user';
}

/** Runtime guard for a `skills/list` entry; malformed entries report diagnostics. */
function toRecord(
  entry: SkillsListEntry,
  diagnostics: InvocableDiagnostic[]
): RuntimeInvocableRecord | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  const name = typeof entry.name === 'string' ? entry.name : '';
  const path = typeof entry.path === 'string' ? entry.path : '';
  if (!name || !path) {
    diagnostics.push({
      severity: 'warning',
      code: 'INVOCATION_DISCOVERY_FAILED',
      message: 'Codex reported a skill entry without name/path; entry skipped.',
      runtimeType: 'codex',
    });
    return undefined;
  }
  const enabled = entry.enabled !== false;
  const descriptor: Omit<InvocableDescriptor, 'id'> = {
    kind: 'runtime.skill',
    runtimeType: 'codex',
    name,
    label:
      (typeof entry.interface?.displayName === 'string' && entry.interface.displayName) || name,
    description: typeof entry.description === 'string' ? entry.description : undefined,
    displayTrigger: `/${name}`,
    origin: {
      owner: 'runtime',
      scope: toInvocableScope(entry.scope),
    },
    execution: {
      mode: 'native-structured',
      fidelity: 'exact',
      arguments: {
        accepted: ['raw'],
        preferred: 'raw',
        transcript: { raw: 'verbatim' },
      },
    },
    availability: enabled
      ? { available: true }
      : {
          available: false,
          reason: 'Skill is disabled in the Codex configuration.',
          code: 'SKILL_DISABLED',
        },
  };
  return {
    descriptor,
    providerLocalKey: name,
    // Native locator: returned only to this adapter at execution time (§8.2).
    nativeLocator: { type: 'skill', name, path },
  };
}

export function createCodexInvocations(deps: CodexInvocationsDeps) {
  const provider = {
    async capabilities(_context: RuntimeDiscoveryContext): Promise<RuntimeInvocationCapabilities> {
      return {
        catalog: 'runtime',
        executionModes: ['native-structured'],
        refresh: 'manual',
        discoveryScope: 'shared-context',
        catalogLifecycle: 'bootstrap-only',
        unknownTextPassthrough: true,
        portableSkills: 'unsupported',
      };
    },

    async discover(
      context: RuntimeDiscoveryContext,
      signal: AbortSignal
    ): Promise<RuntimeInvocableCatalog> {
      if (signal.aborted) {
        throw new Error('discovery aborted');
      }
      const diagnostics: InvocableDiagnostic[] = [];
      const client = await deps.getClient();
      const abortPromise = deps.raceSignal
        ? deps.raceSignal(signal)
        : new Promise<never>((_, reject) => {
            signal.addEventListener('abort', () => reject(new Error('discovery aborted')), {
              once: true,
            });
          });
      const entries = await Promise.race([client.listSkills(context.canonicalCwd), abortPromise]);

      const records: RuntimeInvocableRecord[] = [];
      const seen = new Set<string>();
      for (const entry of entries ?? []) {
        const record = toRecord(entry, diagnostics);
        if (!record) continue;
        // Duplicate local keys would collide on the canonical ID; keep the
        // first and report the rest.
        if (seen.has(record.providerLocalKey)) {
          diagnostics.push({
            severity: 'warning',
            code: 'INVOCATION_DISCOVERY_FAILED',
            message: `Codex reported duplicate skill "${record.providerLocalKey}"; later entries skipped.`,
            runtimeType: 'codex',
          });
          continue;
        }
        seen.add(record.providerLocalKey);
        try {
          const content = await (deps.readFile ?? (path => readFile(path)))(
            (record.nativeLocator as { path: string }).path
          );
          record.contentDigest = createHash('sha256').update(content).digest('base64url');
        } catch {
          record.descriptor = {
            ...record.descriptor,
            availability: {
              available: false,
              reason: 'The Codex skill content could not be verified by the host.',
              code: 'INVOCATION_CONTENT_DIGEST_UNAVAILABLE',
            },
          };
          diagnostics.push({
            severity: 'warning',
            code: 'INVOCATION_CONTENT_DIGEST_UNAVAILABLE',
            message: `Codex skill "${record.providerLocalKey}" could not be content-bound and was disabled.`,
            runtimeType: 'codex',
          });
        }
        records.push(record);
      }
      return {
        items: records,
        diagnostics,
        phase: 'live',
        completeness: 'complete',
      };
    },
  };

  // §9.2: a plugin that claims invocation capabilities but omits required
  // methods fails registration with a contract error.
  const errors = validateInvocationRegistration(provider);
  if (errors.length > 0) {
    throw new Error(`Codex invocations provider contract error: ${errors.join('; ')}`);
  }
  return provider;
}
