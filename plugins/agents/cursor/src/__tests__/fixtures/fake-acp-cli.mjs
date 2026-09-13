#!/usr/bin/env node
// Executable shim so tests can pass this file as the runner's `cliPath`;
// the runner appends the literal `acp` argument, which is ignored here.
await import('./fake-acp-agent.mjs');
