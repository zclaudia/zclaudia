# @zclaudia/plugin-cursor

Cursor Agent CLI runtime plugin for ZClaudia.

The plugin contributes the `cursor` runtime and a ready-to-use Cursor agent profile. It connects
to the local `cursor-agent` executable and injects the ZClaudia MCP bridge into the project.

## Development

```bash
pnpm --filter @zclaudia/plugin-cursor test
pnpm --filter @zclaudia/plugin-cursor build
```

This package ships with ZClaudia and loads automatically from the host-owned built-in
directory. Its ID and `cursor-default` profile contribution remain stable across updates.
Do not add it as a user plugin directory. CLI installation and authentication remain
separate from the plugin; an empty model uses the CLI default.

From the main repository: `pnpm agent:playground --plugin plugins/agents/cursor`.
The package's `dev` command watches the bundled entry and shared agent-common code.
