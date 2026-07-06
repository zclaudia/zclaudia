# Claude Runtime Smoke Check

This smoke check has two modes:

- Deterministic non-live mode for the regular completion gate.
- Opt-in live mode for machines with Claude Code authentication.

Run from the repo root:

```bash
corepack pnpm --filter @zclaudia/server smoke:claude-runtime
```

Expected deterministic behavior:

- The script validates the local smoke harness without starting a real Claude
  Agent SDK session.
- It does not require Claude Code authentication.
- It is safe to include in the focused migration gate.

Run the live SDK smoke explicitly:

```bash
corepack pnpm --filter @zclaudia/server smoke:claude-runtime -- --live --cwd=/path/to/project
```

Expected live behavior:

- The script prints how many Claude Code MCP servers and enabled local plugins
  were loaded from `~/.claude`.
- The first turn prints an init session id.
- The second turn resumes that session id.
- The final turn aborts quickly through the shared AbortController path.

The config count confirms the adapter sees the same Claude Code configuration
that is passed to the Claude Agent SDK.

If the Claude Agent SDK or Claude Code authentication is unavailable, the script
fails with the SDK error. Live mode is not part of normal CI.
