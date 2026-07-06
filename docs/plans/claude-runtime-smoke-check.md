# Claude Runtime Smoke Check

This smoke check is opt-in and calls the real Claude Agent SDK.

Run from the repo root:

```bash
corepack pnpm --filter @zclaudia/server smoke:claude-runtime -- --live --cwd=/path/to/project
```

Expected behavior:

- The first turn prints an init session id.
- The second turn resumes that session id.
- The final turn aborts quickly through the shared AbortController path.

If the Claude Agent SDK or Claude Code authentication is unavailable, the script
fails with the SDK error. This script is not part of normal CI.
