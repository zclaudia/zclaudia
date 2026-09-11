# @zclaudia/plugin-claude

Claude Agent SDK runtime plugin for ZClaudia.

The plugin contributes the `claude` runtime and a ready-to-use Claude agent profile. It uses the
Claude Agent SDK and respects ZClaudia permission modes.

## Development

```bash
pnpm --filter @zclaudia/plugin-claude test
pnpm --filter @zclaudia/plugin-claude build
```

This package ships with ZClaudia and loads automatically from the host-owned built-in
directory. Its ID and `claude-default` profile contribution remain stable across updates.
Do not add it as a user plugin directory. CLI installation and authentication remain
separate from the plugin; an empty model uses the CLI default.

From the main repository: `pnpm agent:playground --plugin plugins/agents/claude`.
The package's `dev` command watches the bundled entry and shared agent-common code.
