# @zclaudia/plugin-codex

Codex app-server runtime plugin for ZClaudia.

The plugin contributes the `codex` runtime and a ready-to-use Codex agent profile. It connects to
the local `codex app-server`, forwards runtime events, and bridges permission requests.

## Development

```bash
pnpm --filter @zclaudia/plugin-codex test
pnpm --filter @zclaudia/plugin-codex build
```

This package ships with ZClaudia and loads automatically from the host-owned built-in
directory. Its ID and `codex-default` profile contribution remain stable across updates.
Do not add it as a user plugin directory. CLI installation and authentication remain
separate from the plugin; an empty model uses the CLI default.

From the main repository: `pnpm agent:playground --plugin plugins/agents/codex`.
The package's `dev` command watches the bundled entry and shared agent-common code.
