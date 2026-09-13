import type {
  InvocableScope,
  PortableSkillAssessment,
  PortableSkillCandidate,
  RuntimeDiscoveryContext,
  RuntimeInvocableCatalog,
  RuntimeInvocableRecord,
  RuntimeInvocationCapabilities,
  RuntimeTurnInput,
} from '@zclaudia/shared/providers';
import { createSkillRuntimeState, type SkillRuntimeState } from './skills.js';
import type { SkillRef } from '@zclaudia/shared/core/skills';

/**
 * URIP adapter for the Pi runtime (design doc §14.4).
 *
 * Pi is the built-in runtime: its invocables ARE ZClaudia's portable skills,
 * published here through the same descriptor model as external runtimes. Pi
 * keeps its internal progressive skill-state implementation, but the host
 * boundary is the typed `portable-skill` turn input — the materialized body is
 * loaded into the run's skill state (a context channel semantically stronger
 * than ordinary user text), which maps to `bridged` execution with exact
 * fidelity. Resource-bearing skills are unsupported: v1 has no resource reader
 * wiring on this transport.
 */

export interface PiSkillRef {
  source: string;
  id: string;
}

export interface PiDiscoveredSkill {
  id: string;
  name: string;
  description?: string;
  source: string;
  eligible?: boolean;
}

export interface PiInvocationsDeps {
  /** Skill discovery seam; defaults to the ZClaudia skill registry. */
  listSkills?: () => PiDiscoveredSkill[];
}

function toScope(source: string): InvocableScope {
  switch (source) {
    case 'workspace':
    case 'project':
      return 'project';
    case 'plugin':
      return 'system';
    default:
      return 'user';
  }
}

export function createPiInvocations(deps: PiInvocationsDeps = {}) {
  const listSkills =
    deps.listSkills ??
    (() => {
      // Default discovery is wired by the host session catalog builder (which
      // already holds the eligible skill registry); standalone use yields an
      // empty catalog rather than importing application code here.
      return [];
    });

  return {
    async capabilities(_context: RuntimeDiscoveryContext): Promise<RuntimeInvocationCapabilities> {
      return {
        catalog: 'static',
        executionModes: ['bridged'],
        refresh: 'manual',
        discoveryScope: 'shared-context',
        catalogLifecycle: 'bootstrap-only',
        // §17.2: Pi keeps its own unqualified /skill parsing — raw text still
        // belongs to it because the adapter IS the active runtime.
        unknownTextPassthrough: true,
        portableSkills: 'context',
      };
    },

    async discover(
      context: RuntimeDiscoveryContext,
      signal: AbortSignal
    ): Promise<RuntimeInvocableCatalog> {
      if (signal.aborted) throw new Error('discovery aborted');
      const skills = listSkills();
      const records: RuntimeInvocableRecord[] = skills.map(skill => ({
        descriptor: {
          kind: 'portable.skill',
          runtimeType: 'pi',
          name: skill.id,
          label: skill.name || skill.id,
          ...(skill.description ? { description: skill.description } : {}),
          displayTrigger: `/skill:${skill.id}`,
          origin: { owner: 'host', scope: toScope(skill.source) },
          execution: {
            mode: 'bridged',
            fidelity: 'exact',
            arguments: { accepted: ['raw'], preferred: 'raw', transcript: { raw: 'verbatim' } },
          },
          availability:
            skill.eligible !== false
              ? { available: true }
              : {
                  available: false,
                  reason: 'Skill is not currently eligible.',
                  code: 'SKILL_INELIGIBLE',
                },
        },
        providerLocalKey: `${skill.source}:${skill.id}`,
        nativeLocator: { source: skill.source, id: skill.id },
      }));
      void context;
      return {
        items: records,
        diagnostics: [],
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
          reason: 'Resource-bearing portable skills are not wired into the Pi context channel yet.',
        };
      }
      return {
        supported: true,
        mode: 'context',
        executionMode: 'bridged',
        fidelity: 'exact',
        resourceAccess: 'none',
      };
    },
  };
}

/**
 * Map a typed portable-skill turn onto Pi's progressive skill state (§14.4):
 * the materialized body is loaded into the context channel, and the run text
 * becomes the user arguments (or the canonical inline hint when none).
 */
export function preparePortableSkillTurn(
  input: Extract<RuntimeTurnInput, { type: 'portable-skill' }>,
  existingState: SkillRuntimeState | undefined
): { state: SkillRuntimeState; text: string } {
  const state: SkillRuntimeState = existingState ?? createSkillRuntimeState([], []);
  // loadedSkillContents values are the raw SKILL.md body text, keyed by the
  // shared skillRefKey formula (`source:id`) — exactly what the progressive
  // skill channel consumes on the next model request.
  // Portable skills enter Pi's progressive channel under the 'external'
  // source (the only SkillSource value that is not a registry-owned scope).
  const ref: SkillRef = { source: 'external', id: input.skill.id };
  const key = `${ref.source}:${ref.id}`;
  if (!state.loadedSkills.some(entry => entry.id === input.skill.id)) {
    state.loadedSkills.push(ref);
  }
  state.loadedSkillContents[key] = input.skill.body;
  const args = input.arguments.type === 'raw' ? input.arguments.value.trim() : '';
  return {
    state,
    text: args || `Use the ${input.skill.name} skill.`,
  };
}
