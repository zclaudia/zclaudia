#!/usr/bin/env node
import { parseServicePort, renderLaunchAgentPlist } from './browser-service-lib.mjs';

const [label, repoRoot, nodeBin, dataDir, logDir, portRaw] = process.argv.slice(2);

if (!label || !repoRoot || !nodeBin || !dataDir || !logDir) {
  console.error(
    'Usage: render-launch-agent.mjs <label> <repoRoot> <nodeBin> <dataDir> <logDir> [port]'
  );
  process.exit(1);
}

let port;
try {
  port = parseServicePort(portRaw || '3100');
} catch {
  console.error(`Invalid port: ${portRaw}`);
  process.exit(1);
}

process.stdout.write(
  renderLaunchAgentPlist({
    label,
    repoRoot,
    nodeBin,
    dataDir,
    logDir,
    port,
  })
);
