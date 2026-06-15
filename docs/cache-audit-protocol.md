# Prefix-cache audit protocol

Instrumentation added in Part C of the agent-resilience work (2026-06-15). Run the server with `ZCLAUDIA_CACHE_AUDIT=1` to enable the `[CacheAudit]` logs emitted by `zclaudia-adapter.ts` (off by default). Grep server stdout for `[CacheAudit]`.

Each run emits:
- A prefix-stability line: `prefix stable=<bool> prompt=<hash> tools=<hash>`, or `PREFIX CHANGED ...` when the system-prompt/skill-catalog or tool-set bytes differ from the previous run in the same session (= the provider prompt prefix cache is invalidated at that run boundary).
- A usage line: `cacheRead=<n> cacheWrite=<n> input=<n> hit=<pct>%` from the last assistant turn's real usage.

## Scenarios
1. **Plain multi-turn** — 3 user messages, no skill/MCP/tool loading. Expect: every run after the first logs `prefix stable=true`, and `hit%` climbs after turn 1 (cacheRead > 0).
2. **Skill load mid-session** — send a message that triggers LoadSkill/RunSkill, then another. If a `PREFIX CHANGED promptStable=false` line appears at the run boundary AFTER the skill loaded, the skill catalog / active skill context is busting the cache between user messages — the prime suspect.
3. **External MCP tool load** — load an MCP tool, then continue. A `toolsStable=false` line means the tool set changed and bust the tools-block cache.
4. **MCP server connect/disconnect mid-session** — watch for prompt instability driven by the MCP instructions delta.

## What the data decides
- If scenarios 2-4 are the ONLY sources of instability and plain multi-turn is stable → the cache is fine for the common case; an append-only refactor is low priority. Document and stop.
- If even plain multi-turn shows `promptStable=false` → something nondeterministic is in the base prompt assembly (ordering, timestamps, set iteration). Find it before any refactor.
- Record observed `hit%` for scenario 1 turns 2-3 as the baseline to beat.

## Suspects ranked (from the 2026-06-15 code read)
1. `activeSkillContext` (loaded skill contents) — mutated by LoadSkill/RunSkill within a session.
2. Conditional skill activation changing `buildSkillCatalog` output between runs.
3. External tool loading changing the tools array.
4. MCP instructions delta in rebuilt history.

## Where the instrumentation lives
- `server/src/infra/providers/context-snapshot.ts` — `diffPrefixForCacheAudit(sessionId, systemPromptText, skillCatalogText, tools)` hashes the prefix and compares to the previous run for the session.
- `server/src/infra/providers/zclaudia-adapter.ts` — calls it next to `captureContextSnapshot` (prefix-stability log) and logs the cache-read ratio next to `recordContextUsage`, both gated on `ZCLAUDIA_CACHE_AUDIT === '1'`.
