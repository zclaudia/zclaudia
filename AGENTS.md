# ZClaudia

See `CLAUDE.md` for the project map, ports, env vars, and dev/build/deploy scripts. This file adds Cursor Cloud–specific operating notes.

## Cursor Cloud specific instructions

Non-obvious caveats for running/testing this repo in the cloud VM. The startup update script already runs `pnpm install` under the pinned Node.

### Node version is pinned to EXACTLY 22.20.0

- `.node-version` pins `22.20.0` and a `preinstall` guard (`scripts/hooks/ensure-node-version.mjs`) hard-fails if the active Node is anything else. The base VM Node is a different version.
- The right version is provided by `fnm` (installed at `/usr/local/bin/fnm`, version 22.20.0 pre-installed as the fnm default). Do NOT rely on bare `node`/`pnpm`.
- Run everything through the repo's wrapper so the correct Node is selected automatically: `bash scripts/with-project-node.sh <cmd>`, or use the root `package.json` scripts (`pnpm dev`, `pnpm test`, `pnpm lint`, `pnpm server:dev`, `pnpm desktop:dev`) which already wrap it.

### Build order: `shared` must be built before server/desktop tests

- `@zclaudia/shared` resolves to its built `dist/` (see its `package.json` `exports`). If `shared/dist` is missing, many `server` and `apps/desktop` tests fail with `Failed to resolve entry for package "@zclaudia/shared"`.
- Before `pnpm test` (or running server/desktop tests directly), build shared first: `bash scripts/with-project-node.sh pnpm --filter @zclaudia/shared run build`.
- `pnpm dev` handles this itself (shared runs `tsc --watch`), so no pre-build is needed just to run the app.

### Running the app (web/standalone mode)

- Preferred for cloud testing: run backend + Vite frontend separately (the Tauri native shell needs a Linux GUI/WebKit and is not needed for browser testing; the Vite frontend is the same UI the e2e suite drives).
  - Backend: `ZCLAUDIA_DATA_DIR=/tmp/zclaudia-dev/ PORT=3100 SERVER_HOST=127.0.0.1 bash scripts/with-project-node.sh pnpm --filter @zclaudia/server run dev` (waits for `SERVER_READY:3100`; health at `http://127.0.0.1:3100/health`).
  - Frontend: `VITE_LOCAL_SERVER_PORT=3100 bash scripts/with-project-node.sh pnpm --filter @zclaudia/desktop run dev` (Vite on `http://localhost:1420`, `strictPort`).
- Set `ZCLAUDIA_DATA_DIR` to isolate SQLite/data (default is `~/.zclaudia`).

### Agent gating (creating projects/sessions)

- The UI blocks project/session creation with "No agent available yet" until a usable agent exists. "Usable" (see `server/src/domains/agent-readiness/check.ts`) requires: an agent profile → an LLM profile that has a credential → whose model list includes the agent's `model`.
- The server auto-seeds a "Default Coding Agent" at startup ONLY once a default LLM profile exists (`ensureDefaultAgentProfile`, runs at DB init). After creating the first LLM profile, restart the server to trigger the seed.
- The seeded agent's default `model` may not match the LLM profile's declared `models[]`, giving readiness `no_model`; align them (PATCH `/api/agent-profiles/:id` with a model that is in the profile's `models[]`).
- Real AI chat needs a provider key (`ANTHROPIC_API_KEY` or `OPENAI_*` — see `.env.example`); no key is present by default. Profiles created via the API are NOT network-validated, but the LLM-profile editor's model probe/fetch in the UI hits the network and will hang without a reachable provider.
- Env credentials are materialized onto the default LLM profile at startup (`autoDetectProviders`), but the seeded profile has an EMPTY `models[]`. For a custom/non-registry model id (e.g. an OpenAI-compatible proxy serving a model pi-ai's registry doesn't know), readiness reports `no_model` until that model is declared in the profile's `models[]` (PUT `/api/llm-profiles/:id`) AND the agent's `model` matches it. Runtime execution itself still works for unregistered ids via the openai-compat literal path; only the readiness gate needs the declaration.

### Gateway & known environment-limited test failures

- The sibling gateway repo `../zclaudia-gateway/` is NOT present in this workspace, so `pnpm gateway:dev` and gateway-mode e2e fail. Use `pnpm test:e2e:local` (`TEST_MODES=local`).
- Two `server` integration tests fail purely due to the environment, not code: the critical-Bash-command guard test (needs `bwrap`/`socat`; server logs `Bash sandbox unavailable`), and the AI auto-commit end-to-end test (needs a live LLM key).
- `pnpm lint` reports 0 errors (many pre-existing warnings). There is also one pre-existing unit-test assertion mismatch in `apps/desktop` (`topLevelViewStore` `openAgents` tab) unrelated to setup.
