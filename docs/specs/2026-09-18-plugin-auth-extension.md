# Plugin auth extension — direction note

Date: 2026-09-18
Status: proposed direction (no implementation yet)

## Problem

The architecture says agents are provided by plugins (`plugins/agents/*`, wired
through `@zclaudia/plugin-sdk`), yet Codex's login flow is hardcoded on both
sides of the host:

- Server: `server/src/domains/llm-profiles/codex-oauth-service.ts` (plus
  `codex-oauth-pi.ts`, `codex-oauth-errors.ts`, migration `005_llm_profile_oauth`)
  implements the OpenAI OAuth/device-code exchange behind
  `/api/llm-profiles/:id/oauth/{start,status,cancel,signout}`.
- Desktop: `features/agents/CodexOAuth{Card,LoginModal,Section}.tsx` (~590
  lines) plus `codexOauthSessions` state in `stores/llmProfileMetaStore.ts`
  render and drive that flow.

Every additional built-in agent with a login step (Claude, Cursor, …) will grow
these same files unless the seam is inverted.

## Why not now

`@zclaudia/plugin-sdk@0.4.0` has auth *probing* (`ManagedRuntimeAuthProbe`,
`ManagedRuntimeAuthState = authenticated | auth-required | unknown |
probe-failed` — see `plugin-sdk/dist/managed-runtimes.d.ts`) but **no
interactive login contribution**: a plugin cannot declare a login UI or an
OAuth exchange that the host renders/executes. Adding one requires a published
SDK minor plus server + desktop protocol work; it cannot be done inside this
repo alone.

## Proposed seam

1. **SDK**: add a manifest contribution, e.g.
   `auth?: { loginPanelId: string; providerId: string; methods: ('browser' | 'device_code')[] }`,
   and a runtime API `host.auth.startLogin(providerId)` /
   `onAuthStateChanged`. The plugin owns the exchange (or delegates to a
   server-side plugin service); the host owns only chrome and session state.
2. **Server**: `domains/llm-profiles` exposes a generic oauth-session
   resource keyed by provider id; `codex-oauth-service.ts` moves into the
   codex plugin package as the first consumer.
3. **Desktop**: replace the three `CodexOAuth*.tsx` files with a generic
   `AgentAuthSection` that resolves the login panel from the plugin
   contribution; `codexOauthSessions` becomes a generic
   `Map<providerId, AuthSessionState>`.

## Interim rule

Until the SDK ships the contribution, keep new auth UI out of the host:
codex-specific UI stays quarantined in the three files above, and new agents
with login flows must not add sibling `XxxOAuth*.tsx` files — extend the
generic seam instead (or block on the SDK change).
