import type {
  InvocableDiagnostic,
  PortableSkillAssessment,
  PortableSkillCandidate,
  RuntimeDiscoveryContext,
  RuntimeInvocableCatalog,
  RuntimeInvocableRecord,
  RuntimeInvocationCapabilities,
} from '@zclaudia/plugin-sdk/invocations';

/**
 * URIP adapter for the Cursor runtime (design doc §14.3).
 *
 * Catalog: commands advertised by the ACP agent itself via
 * `available_commands_update` (the acp-events mapper already collects them for
 * SystemInfo). Per §14.3, headless native expansion of that syntax has NOT
 * been probed, so entries are published `emulated` / `best-effort` — compiled
 * into an ordinary ACP prompt — and never labeled native. If a future probe
 * verifies expansion, this flips to `native-text` / `exact` with a fixture.
 *
 * Discovery opens a short-lived ACP session with the same client the runner
 * uses and closes it after a bounded collection window.
 */

export const DISCOVERY_COLLECT_MS = 1_500;

export interface CursorAcpCommand {
  name: string;
  description?: string;
}

export interface CursorDiscoveryClient {
  onUpdate: (
    cb: (update: {
      sessionUpdate: string;
      availableCommands?: Array<{ name: string; description?: string }>;
    }) => void
  ) => void;
  newSession: (cwd: string) => Promise<void>;
  close: () => Promise<void>;
}

export interface CursorInvocationsDeps {
  newClient: (cwd: string, signal: AbortSignal) => Promise<CursorDiscoveryClient>;
  collectMs?: number;
  delay?: (ms: number) => Promise<void>;
}

export function createCursorInvocations(deps: CursorInvocationsDeps) {
  const delay = deps.delay ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));

  const provider = {
    async capabilities(_context: RuntimeDiscoveryContext): Promise<RuntimeInvocationCapabilities> {
      return {
        catalog: 'runtime',
        executionModes: ['emulated'],
        refresh: 'manual',
        discoveryScope: 'shared-context',
        catalogLifecycle: 'bootstrap-only',
        unknownTextPassthrough: true,
        portableSkills: 'emulated',
      };
    },

    async discover(
      context: RuntimeDiscoveryContext,
      signal: AbortSignal
    ): Promise<RuntimeInvocableCatalog> {
      if (signal.aborted) throw new Error('discovery aborted');
      const diagnostics: InvocableDiagnostic[] = [];

      const client = await deps.newClient(context.canonicalCwd, signal);
      const commands: CursorAcpCommand[] = [];
      const seen = new Set<string>();
      client.onUpdate(update => {
        if (update.sessionUpdate !== 'available_commands_update') return;
        for (const command of update.availableCommands ?? []) {
          if (!command?.name || seen.has(command.name)) continue;
          seen.add(command.name);
          commands.push(command);
        }
      });

      const abortPromise = new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('discovery aborted')), {
          once: true,
        });
      });
      try {
        await Promise.race([client.newSession(context.canonicalCwd), abortPromise]);
        await Promise.race([delay(deps.collectMs ?? DISCOVERY_COLLECT_MS), abortPromise]);
      } finally {
        await client.close().catch(() => undefined);
      }

      const records: RuntimeInvocableRecord[] = [];
      for (const command of commands) {
        records.push({
          descriptor: {
            kind: 'runtime.command',
            runtimeType: 'cursor',
            name: command.name,
            label: command.name,
            ...(command.description ? { description: command.description } : {}),
            displayTrigger: `/${command.name}`,
            origin: { owner: 'runtime', scope: 'system' },
            execution: {
              mode: 'emulated',
              fidelity: 'best-effort',
              arguments: { accepted: ['raw'], preferred: 'raw', transcript: { raw: 'verbatim' } },
            },
            availability: { available: true },
          },
          providerLocalKey: command.name,
          nativeLocator: { type: 'acp-command', name: command.name },
        });
      }
      return {
        items: records,
        diagnostics,
        phase: 'live',
        completeness: 'complete',
      };
    },

    async assessPortableSkill(
      skill: PortableSkillCandidate,
      _context: RuntimeDiscoveryContext,
      _signal: AbortSignal
    ): Promise<PortableSkillAssessment> {
      if (skill.resourceManifest.length > 0) {
        return {
          supported: false,
          mode: 'unsupported',
          code: 'PORTABLE_SKILL_RESOURCE_UNAVAILABLE',
          reason:
            'This skill requires resource files, which emulated Cursor execution cannot provide.',
        };
      }
      return {
        supported: true,
        mode: 'emulated',
        executionMode: 'emulated',
        fidelity: 'best-effort',
        resourceAccess: 'none',
      };
    },
  };

  return provider;
}
