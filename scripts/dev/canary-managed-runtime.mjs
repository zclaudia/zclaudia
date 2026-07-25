#!/usr/bin/env node
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ManagedRuntimeService } from '../../server/dist/application/managed-runtimes/service.js';
import { PluginPackageService } from '../../server/dist/application/plugins/package-service.js';

function usage() {
  console.error(
    'Usage: pnpm canary:managed-runtime -- (--plugin-package /absolute/plugin.zplugin | --plugin-dir /absolute/plugin/directory) [--runtime name] [--data-dir directory] [--keep-data]'
  );
}

const args = process.argv.slice(2);
let pluginDir;
let pluginPackage;
let runtime;
let dataDir;
let keepData = false;
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === '--') continue;
  if (arg === '--plugin-dir') pluginDir = args[++index];
  else if (arg === '--plugin-package') pluginPackage = args[++index];
  else if (arg === '--runtime') runtime = args[++index];
  else if (arg === '--data-dir') dataDir = args[++index];
  else if (arg === '--keep-data') keepData = true;
  else {
    usage();
    process.exit(2);
  }
}
if ((!pluginDir && !pluginPackage) || (pluginDir && pluginPackage)) {
  usage();
  process.exit(2);
}

const temporaryDataDir =
  dataDir === undefined
    ? await mkdtemp(path.join(tmpdir(), 'zclaudia-managed-runtime-canary-'))
    : undefined;
dataDir = path.resolve(dataDir ?? temporaryDataDir);

class CanaryPluginLoader {
  constructor(dataDirectory) {
    this.dataDirectory = dataDirectory;
    this.plugins = new Map();
  }

  getPlugin(id) {
    return this.plugins.get(id);
  }

  async remove(id) {
    return this.plugins.delete(id);
  }

  async discover() {
    const manifests = [];
    const pluginsRoot = path.join(this.dataDirectory, 'plugins');
    const entries = await readdir(pluginsRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pluginPath = path.join(pluginsRoot, entry.name);
      const manifest = JSON.parse(await readFile(path.join(pluginPath, 'plugin.json'), 'utf8'));
      this.plugins.set(manifest.id, { manifest, path: pluginPath, isActive: false });
      manifests.push(manifest);
    }
    return manifests;
  }
}

try {
  let absolutePluginDir;
  if (pluginPackage) {
    const absolutePackage = path.resolve(pluginPackage);
    const loader = new CanaryPluginLoader(dataDir);
    const packages = new PluginPackageService({
      dataDir,
      loader,
      managedRuntimeReferences: { releasePluginReference: async () => {} },
    });
    const preview = await packages.inspectPackage(absolutePackage, path.basename(absolutePackage));
    await packages.installPackage(preview.token);
    absolutePluginDir = path.join(dataDir, 'plugins', preview.manifest.id);
    console.log(
      JSON.stringify(
        {
          phase: 'plugin-installed',
          pluginId: preview.manifest.id,
          pluginVersion: preview.manifest.version,
          packageSha256: preview.sha256,
        },
        null,
        2
      )
    );
  } else {
    absolutePluginDir = path.resolve(pluginDir);
  }
  const manifest = JSON.parse(await readFile(path.join(absolutePluginDir, 'plugin.json'), 'utf8'));
  const compatibility = JSON.parse(
    await readFile(path.join(absolutePluginDir, 'runtime-compatibility.json'), 'utf8')
  );
  runtime ??= compatibility.runtime;
  const declaredRuntimes = (manifest.contributes?.agentRuntimes ?? []).map(entry => entry.type);
  const isolatedPath =
    process.platform === 'win32'
      ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
      : '/usr/bin:/bin';
  const service = new ManagedRuntimeService({
    dataDir,
    platform: process.platform,
    arch: process.arch,
    policy: 'managed-ask',
    env: { ...process.env, PATH: isolatedPath },
  });
  await service.registerPlugin({
    pluginId: manifest.id,
    pluginVersion: manifest.version,
    pluginPath: absolutePluginDir,
    publisher: manifest.publisher,
    publisherVerified: false,
    runtimes: declaredRuntimes,
  });

  const offered = await service.resolveForPlugin(manifest.id, runtime, {
    headless: false,
    allowAutoInstall: false,
  });
  if (offered.status !== 'needs-approval') {
    throw new Error(`Expected needs-approval before install, got ${offered.status}.`);
  }
  console.log(
    JSON.stringify(
      {
        phase: 'approval',
        status: offered.status,
        artifact: offered.artifact,
      },
      null,
      2
    )
  );

  const installed = await service.installForPlugin({
    pluginId: manifest.id,
    pluginVersion: manifest.version,
    runtime,
    approved: true,
    pin: true,
  });
  if (
    installed.status !== 'resolved' ||
    installed.source !== 'managed' ||
    installed.verification.checksumVerified !== true
  ) {
    throw new Error(
      `Managed runtime installation did not resolve successfully: ${installed.status}`
    );
  }
  console.log(
    JSON.stringify(
      {
        phase: 'installed',
        status: installed.status,
        runtime,
        version: installed.version,
        source: installed.source,
        authState: installed.authState,
        compatibilityState: installed.compatibilityState,
        checksumVerified: installed.verification.checksumVerified,
        sha256: installed.verification.sha256,
        executablePath: installed.executablePath,
      },
      null,
      2
    )
  );

  const resolved = await service.resolveForPlugin(manifest.id, runtime, {
    headless: true,
    allowAutoInstall: false,
  });
  if (resolved.status !== 'resolved' || resolved.source !== 'managed') {
    throw new Error(`Pinned managed runtime did not resolve again: ${resolved.status}.`);
  }
  console.log(
    JSON.stringify(
      {
        phase: 'resolve-again',
        status: resolved.status,
        version: resolved.version,
        source: resolved.source,
        authState: resolved.authState,
      },
      null,
      2
    )
  );
} finally {
  if (temporaryDataDir && !keepData) {
    await rm(temporaryDataDir, { recursive: true, force: true });
  } else {
    console.log(`Managed runtime data retained at ${dataDir}`);
  }
}
