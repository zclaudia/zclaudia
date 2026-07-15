# Unified record status: draft + availability across profiles

**Status:** Proposal (design) — 2026-07-15
**Scope:** Agent profiles, LLM profiles, MCP servers, Skills (the four "Agents" library record types)
**Supersedes:** the create-mode autosave behavior added to `SkillEditor` / `McpServerEditor` on 2026-07-15 (create becomes "make a draft"; the `savedIdRef` create→update transition and re-select-on-first-create remount are removed).

## Problem

The four record types each express "this thing isn't usable right now" a different way, and only partially:

| Type | Completeness gate today | Availability signal today |
|---|---|---|
| Agent | create modal requires runtime + LLM + model | **global** `AgentReadiness { usable, reason }` + per-record `status: active \| readonly` |
| LLM | server hard-rejects a model-less save (F2) | none persisted — only a live probe |
| MCP | name + command/url required to create | runtime `status.state`: connected / failed / needs-auth / disabled |
| Skill | content required to save | `eligible: false` → "Blocked" (os/bin/env unmet) |

Consequences:
- No uniform way to say "exists but not finished" → the "new" flow is awkward (autosave silently commits the instant minimal fields become valid; abandoning before that persists nothing).
- The "a dependency broke" case (e.g. an agent whose LLM profile went invalid) is only represented for agents, and only globally — other types hide or scatter it.

## Model

One **derived status** per record, computed from two independent facets:

```ts
// shared/src/core/record-status.ts (new)
export type RecordAvailabilityReason =
  | 'no_llm_profile' | 'no_credential' | 'no_model'   // agent, llm
  | 'llm_unavailable'                                  // agent (its LLM broke)
  | 'unreachable'                                      // llm (endpoint/key rejected)
  | 'needs_auth' | 'connect_failed'                    // mcp
  | 'requirement_unmet';                               // skill (os/bin/env)

export interface RecordStatus {
  /** Intrinsic: are the record's OWN required fields present? */
  completeness: 'ready' | 'draft';
  /** Extrinsic: are its dependencies/preconditions satisfied? */
  availability: { usable: true } | { usable: false; reason: RecordAvailabilityReason };
  /** User toggle (mcp today; extendable). */
  disabled?: boolean;
}
```

**Single surfaced chip, priority-ordered:** `Draft` → `Unavailable: <reason>` → `Disabled` → `Ready`.
One `<StatusChip>` component + one reason→copy/fix-action map, reused in every library card and editor header. This replaces `eligible`, `status.state`, and the global readiness gate as the *display* vocabulary (the underlying checks stay; they feed this).

- **Completeness** is cheap and mostly derivable from persisted fields (see per-type table). Persisted as a `draft` flag where the record can exist incomplete (llm/mcp/agent).
- **Availability** is computed at read time (dependencies fail at runtime; can't be prevented). Server returns it on the record DTO.

## Per-type mapping

| Type | `draft` when… | `unavailable(reason)` when… | New-flow |
|---|---|---|---|
| **LLM** | 0 models **or** no credential | `unreachable` (probe fails) | **instant blank draft** (server id, name "Untitled"); relax F2 to persist drafts |
| **MCP** | no command (stdio) / no url (remote) | `needs_auth`, `connect_failed` | **instant blank draft** (server id) |
| **Agent** | no LLM bound / no model | `no_llm_profile`, `no_credential`, `no_model`, `llm_unavailable` | **keep the create modal** (auto-binds default LLM+model → born `ready`); gains the chip afterward |
| **Skill** | content empty/template-only | `requirement_unmet` (os/bin/env) | **tiny ID-only prompt** → seed a draft `SKILL.md` from the template; `draft` until content is meaningful |

Two constraints drove the new-flow column:
1. **Skill is file-backed — the ID is the filename.** It cannot persist without an ID, so a minimal ID prompt is irreducible (decided: keep an ID-only prompt, not a full modal).
2. **The agent modal produces a *usable* record** by auto-binding a default LLM+model; a blank agent draft would be born unusable. Decided: keep the agent modal; "instant draft" applies to LLM + MCP only.

So the create surfaces become: **LLM/MCP = instant draft**, **Skill = ID prompt → draft**, **Agent = modal (unchanged)** — all four then share the status chip and edit-only autosave.

## Server / data changes

1. **Persist incomplete records.** Add a `draft`/completeness marker (or derive from fields) for llm/mcp/agent. **Relax the LLM F2 reject** so a model-less profile saves as `draft` instead of erroring; same for MCP no-command and agent no-LLM on the create path.
2. **Migration** to add the status column(s) where persisted; backfill existing rows as `ready` (they were valid under the old invariant). Follow the repo's migration numbering (see CLAUDE.md's migration notes).
3. **Availability computation per type** on read, returned on the record DTO (generalizes the current `AgentReadiness` from global to per-record, and folds in skill `eligible` and MCP `status.state`).
4. **Invariant change:** "a persisted record is always valid" becomes "a persisted record is `ready` **or** `draft`." Every server consumer must respect it (below).

## Runtime / readiness

- **Draft or unavailable records are not runnable.** Session creation and agent resolution must skip/guard them (a draft agent, or a ready agent whose LLM is `unavailable`, cannot start a session — surface the reason + fix action instead of a hard failure).
- The global `AgentReadiness` becomes a *rollup* of per-record availability ("is there ≥1 ready+usable agent") rather than the source of truth.

## Desktop UI

- New shared `<StatusChip status={...}>` (semantic tokens only, per `docs/ui-conventions.md`) in library cards **and** editor `ProfileHeader`s. Replaces the ad-hoc "Eligible/Blocked", `status.state` pills, and the "Read-only" badge.
- **Editors become edit-only autosave** (no create-mode branch): create is handled by the draft/modal flows above, so the editors always open on an existing record. This removes the `savedIdRef` create→update dance and the re-select-on-first-create remount added on 2026-07-15.
- New-flow wiring in `AgentsContent`:
  - LLM/MCP "+ New" → create a draft server-side, then select it → editor opens on the draft.
  - Skill "+ New" → ID prompt → create draft file → select.
  - Agent "+ New" → existing modal (unchanged).
- Unavailable/draft records stay **visible** in the library with their chip + a "finish setup" / "fix" affordance — never silently hidden.

## Phased rollout

1. **Shared model** — `record-status.ts` types + a pure `resolveRecordStatus()` per type (unit-tested in isolation).
2. **Server** — persistence + migration + relax create validation to accept drafts + per-record availability on DTOs. Guard runtime/session paths against draft/unavailable.
3. **Desktop status surface** — `<StatusChip>`, consume status in cards + headers (read-only; no behavior change yet).
4. **Desktop new-flows** — LLM/MCP instant-draft, Skill ID-prompt, keep Agent modal; strip create-mode autosave from the editors.
5. **Readiness rollup** — repoint the global gate at per-record availability; session-UI guards + reason/fix copy.
6. **Tests + migration verification** across all layers.

Each phase is independently shippable: phases 1–3 add the vocabulary with **no behavior change**; phase 4 is the flow switch; phase 5 the runtime tightening.

## Open risks / to resolve during planning

- **Draft agents & the readiness rollup:** confirm exact "runnable" predicate (ready ∧ usable) and how session creation surfaces a blocked selection.
- **Skill "meaningful content" threshold** for draft→ready (template-only vs any edit) — avoid flip-flapping the chip on every keystroke.
- **Migration ordering** vs. other pending migrations; whether completeness is persisted or fully derived (deriving avoids a column but needs the compute on every read).
- **Cleanup of abandoned drafts** (a blank LLM/MCP draft the user never finishes) — TTL sweep, or leave them visible as drafts indefinitely.
