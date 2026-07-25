import { createServer, type Server } from 'node:http';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  ManagedRuntimeArtifact,
  RuntimeCompatibilityDescriptor,
} from '@zclaudia/shared/plugins/managed-runtimes';
import { buildZip, symlinkEntry } from '../../plugins/__tests__/zip-test-utils.js';
import { ManagedRuntimeService } from '../service.js';

const temporaryDirectories: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      server =>
        new Promise<void>(resolve => {
          server.close(() => resolve());
        })
    )
  );
  await Promise.all(
    temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))
  );
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'zclaudia-managed-runtime-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function fakeCli(version: string): Buffer {
  return Buffer.from(`#!${process.execPath}
const args = process.argv.slice(2);
if (args.includes('--version')) {
  console.log('fixture ${version}');
} else if (args.includes('--probe')) {
  console.log('PROBE_OK');
} else if (args[0] === 'auth' && args[1] === 'status') {
  if (process.env.OFFICIAL_FAKE_TOKEN === 'preserved' && process.env.HOME === '/host/home') {
    console.log('AUTH_OK');
  } else {
    console.log('AUTH_REQUIRED');
    process.exitCode = 2;
  }
} else {
  console.log(JSON.stringify({ executable: process.argv[1], args }));
}
`);
}

async function executable(directory: string, name: string, version: string): Promise<string> {
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, name);
  await writeFile(file, fakeCli(version));
  await chmod(file, 0o755);
  return file;
}

async function fixtureServer(
  routes: Record<
    string,
    | Buffer
    | {
        body: Buffer;
        contentLength?: number;
        interrupt?: boolean;
      }
  >
): Promise<{ origin: string; requests: () => number }> {
  let requestCount = 0;
  const server = createServer((req, res) => {
    requestCount += 1;
    const route = routes[req.url ?? ''];
    if (!route) {
      res.statusCode = 404;
      res.end();
      return;
    }
    const response = Buffer.isBuffer(route) ? { body: route } : route;
    res.statusCode = 200;
    res.setHeader('content-length', response.contentLength ?? response.body.length);
    if (response.interrupt) {
      res.write(response.body.subarray(0, Math.max(1, response.body.length >> 1)));
      res.destroy();
      return;
    }
    res.end(response.body);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server did not start');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests: () => requestCount,
  };
}

function descriptor(
  artifact?: ManagedRuntimeArtifact,
  options: {
    versions?: Array<{ version: string; artifact: ManagedRuntimeArtifact }>;
    minimum?: string;
    testedMaximum?: string;
    knownIncompatible?: string[];
  } = {}
): RuntimeCompatibilityDescriptor {
  const versions =
    options.versions ??
    (artifact
      ? [
          {
            version: '1.2.3',
            artifact,
          },
        ]
      : []);
  return {
    schemaVersion: 1,
    runtime: 'fixture',
    executable: {
      command: 'fixture',
      versionArgs: ['--version'],
      versionPattern: '(\\d+\\.\\d+\\.\\d+)',
    },
    versionPolicy: {
      minimum: options.minimum ?? '1.2.0',
      testedMaximum: options.testedMaximum ?? '1.2.9',
      knownIncompatible: options.knownIncompatible ?? ['1.2.5'],
    },
    probe: { kind: 'command', args: ['--probe'] },
    managedInstall:
      versions.length > 0
        ? {
            recommendedVersion: versions.at(-1)?.version,
            versions: versions.map(entry => ({
              version: entry.version,
              artifacts: { 'linux-x64': entry.artifact },
            })),
            authProbe: {
              args: ['auth', 'status'],
              authenticatedPattern: 'AUTH_OK',
              unauthenticatedPattern: 'AUTH_REQUIRED',
            },
          }
        : undefined,
  };
}

function artifact(url: string, bytes: Buffer, archiveFormat: 'raw' | 'zip' = 'raw') {
  return {
    url,
    sha256: sha256(bytes),
    size: bytes.length,
    archiveFormat,
    executablePath: archiveFormat === 'raw' ? 'bin/fixture' : 'bin/fixture',
  } satisfies ManagedRuntimeArtifact;
}

async function service(
  options: {
    dataDir?: string;
    path?: string;
    policy?: 'system-only' | 'managed-ask' | 'managed-auto';
    mirrorOrigin?: string;
    token?: string;
    trustedPublishers?: string[];
  } = {}
): Promise<ManagedRuntimeService> {
  const dataDir = options.dataDir ?? (await temporaryDirectory());
  return new ManagedRuntimeService({
    dataDir,
    platform: 'linux',
    arch: 'x64',
    policy: options.policy,
    trustedPublishers: options.trustedPublishers,
    enterpriseMirrorOrigins: options.mirrorOrigin ? [options.mirrorOrigin] : [],
    env: {
      ...process.env,
      PATH: options.path ?? process.env.PATH,
      HOME: '/host/home',
      OFFICIAL_FAKE_TOKEN: options.token ?? 'preserved',
    },
    gcGraceMs: 0,
  });
}

async function registerPlugin(
  runtimeService: ManagedRuntimeService,
  config: RuntimeCompatibilityDescriptor,
  pluginId = 'com.example.fixture',
  publisher: { name: string; verified: boolean } = {
    name: 'Untrusted Fixture',
    verified: false,
  }
): Promise<void> {
  const directory = await temporaryDirectory();
  await writeFile(
    path.join(directory, 'runtime-compatibility.json'),
    `${JSON.stringify(config)}\n`
  );
  await runtimeService.registerPlugin({
    pluginId,
    pluginVersion: '1.0.0',
    pluginPath: directory,
    publisher: publisher.name,
    publisherVerified: publisher.verified,
    runtimes: ['fixture'],
  });
}

function registerCatalog(
  runtimeService: ManagedRuntimeService,
  config: RuntimeCompatibilityDescriptor,
  pluginId = 'com.example.fixture'
): void {
  runtimeService.registerCatalogDescriptor({
    pluginId,
    pluginVersion: '1.0.0',
    descriptor: config,
  });
}

describe('ManagedRuntimeService resolution', () => {
  it('uses explicit, pinned managed, system, then installed managed in order', async () => {
    const root = await temporaryDirectory();
    const systemDir = path.join(root, 'system');
    const explicitPath = await executable(path.join(root, 'explicit'), 'fixture', '1.2.3');
    const systemPath = await executable(systemDir, 'fixture', '1.2.4');
    const bytes = fakeCli('1.2.3');
    const http = await fixtureServer({ '/fixture': bytes });
    const runtimeService = await service({
      dataDir: path.join(root, 'data'),
      path: `${systemDir}${path.delimiter}${process.env.PATH ?? ''}`,
      mirrorOrigin: http.origin,
    });
    const config = descriptor(artifact(`${http.origin}/fixture`, bytes));
    registerCatalog(runtimeService, config);

    const explicit = await runtimeService.resolveForPlugin('com.example.fixture', 'fixture', {
      explicitPath,
      headless: true,
    });
    expect(explicit.source).toBe('explicit');
    expect(explicit.executablePath).toBe(explicitPath);

    const installed = await runtimeService.installForPlugin({
      pluginId: 'com.example.fixture',
      pluginVersion: '1.0.0',
      runtime: 'fixture',
      approved: true,
      pin: true,
    });
    expect(installed.source).toBe('managed');

    const pinned = await runtimeService.resolveForPlugin('com.example.fixture', 'fixture');
    expect(pinned.source).toBe('managed');
    await runtimeService.pinVersion('com.example.fixture', '1.0.0', 'fixture');

    const system = await runtimeService.resolveForPlugin('com.example.fixture', 'fixture');
    expect(system.source).toBe('system');
    expect(system.executablePath).toBe(systemPath);

    await rm(systemPath);
    const managedFallback = await runtimeService.resolveForPlugin('com.example.fixture', 'fixture');
    expect(managedFallback.source).toBe('managed');
  });

  it('blocks missing, old, and known-incompatible explicit CLIs but warns for newer CLIs', async () => {
    const root = await temporaryDirectory();
    const runtimeService = await service({ path: '' });
    registerCatalog(runtimeService, descriptor());

    const missing = await runtimeService.resolveForPlugin('com.example.fixture', 'fixture', {
      explicitPath: path.join(root, 'missing'),
    });
    expect(missing).toMatchObject({ status: 'blocked', compatibilityState: 'missing' });
    expect(
      await runtimeService.resolveForPlugin('com.example.fixture', 'fixture', { headless: true })
    ).toMatchObject({
      status: 'managed-artifact-unavailable',
      compatibilityState: 'missing',
    });

    const oldPath = await executable(root, 'old', '1.1.9');
    const old = await runtimeService.resolveForPlugin('com.example.fixture', 'fixture', {
      explicitPath: oldPath,
    });
    expect(old).toMatchObject({ status: 'blocked', compatibilityState: 'too-old' });

    const incompatiblePath = await executable(root, 'bad', '1.2.5');
    const incompatible = await runtimeService.resolveForPlugin('com.example.fixture', 'fixture', {
      explicitPath: incompatiblePath,
    });
    expect(incompatible).toMatchObject({
      status: 'blocked',
      compatibilityState: 'known-incompatible',
    });

    const newerPath = await executable(root, 'new', '1.3.0');
    const newer = await runtimeService.resolveForPlugin('com.example.fixture', 'fixture', {
      explicitPath: newerPath,
    });
    expect(newer).toMatchObject({
      status: 'resolved',
      compatibilityState: 'untested-newer',
      source: 'explicit',
    });
    expect(newer.warning).toMatch(/newer than tested/i);
  });

  it('offers managed install for rejected system CLIs but never downgrades an untested newer one', async () => {
    const root = await temporaryDirectory();
    const systemDir = path.join(root, 'system');
    await executable(systemDir, 'fixture', '1.1.9');
    const bytes = fakeCli('1.2.3');
    const http = await fixtureServer({ '/fixture': bytes });
    const runtimeService = await service({
      path: systemDir,
      policy: 'managed-ask',
      mirrorOrigin: http.origin,
    });
    registerCatalog(runtimeService, descriptor(artifact(`${http.origin}/fixture`, bytes)));

    expect(
      await runtimeService.resolveForPlugin('com.example.fixture', 'fixture', { headless: true })
    ).toMatchObject({
      status: 'needs-approval',
      compatibilityState: 'too-old',
      artifact: { version: '1.2.3' },
    });

    await executable(systemDir, 'fixture', '1.2.5');
    expect(
      await runtimeService.resolveForPlugin('com.example.fixture', 'fixture', { headless: true })
    ).toMatchObject({
      status: 'needs-approval',
      compatibilityState: 'known-incompatible',
    });

    await executable(systemDir, 'fixture', '1.3.0');
    expect(
      await runtimeService.resolveForPlugin('com.example.fixture', 'fixture', { headless: true })
    ).toMatchObject({
      status: 'resolved',
      source: 'system',
      compatibilityState: 'untested-newer',
      warning: expect.stringMatching(/newer than tested/i),
    });
    expect(http.requests()).toBe(0);
  });

  it('implements system-only, managed-ask, trusted auto, and untrusted auto policies', async () => {
    const bytes = fakeCli('1.2.3');
    const http = await fixtureServer({ '/fixture': bytes });
    const config = descriptor(artifact(`${http.origin}/fixture`, bytes));

    const systemOnly = await service({
      policy: 'system-only',
      path: '',
      mirrorOrigin: http.origin,
    });
    registerCatalog(systemOnly, config);
    expect(
      await systemOnly.resolveForPlugin('com.example.fixture', 'fixture', { headless: true })
    ).toMatchObject({ status: 'system-only' });

    const ask = await service({ policy: 'managed-ask', path: '', mirrorOrigin: http.origin });
    registerCatalog(ask, config);
    expect(
      await ask.resolveForPlugin('com.example.fixture', 'fixture', { headless: true })
    ).toMatchObject({
      status: 'needs-approval',
      message: expect.stringMatching(/headless/i),
    });

    const disallowedMirror = await service({ policy: 'managed-ask', path: '' });
    registerCatalog(disallowedMirror, config);
    expect(
      await disallowedMirror.resolveForPlugin('com.example.fixture', 'fixture', {
        headless: true,
      })
    ).toMatchObject({
      status: 'managed-artifact-unavailable',
      message: expect.stringMatching(/require HTTPS/i),
    });

    const trustedAuto = await service({
      policy: 'managed-auto',
      path: '',
      mirrorOrigin: http.origin,
    });
    registerCatalog(trustedAuto, config);
    expect(
      await trustedAuto.resolveForPlugin('com.example.fixture', 'fixture', { headless: true })
    ).toMatchObject({ status: 'resolved', source: 'managed' });

    const untrustedAuto = await service({
      policy: 'managed-auto',
      path: '',
      mirrorOrigin: http.origin,
      trustedPublishers: ['Untrusted Fixture'],
    });
    await registerPlugin(untrustedAuto, config);
    expect(
      await untrustedAuto.resolveForPlugin('com.example.fixture', 'fixture', { headless: true })
    ).toMatchObject({
      status: 'needs-approval',
      message: expect.stringMatching(/not trusted/i),
    });

    const verifiedPublisherAuto = await service({
      policy: 'managed-auto',
      path: '',
      mirrorOrigin: http.origin,
      trustedPublishers: ['Verified Fixture'],
    });
    await registerPlugin(verifiedPublisherAuto, config, 'com.example.verified', {
      name: 'Verified Fixture',
      verified: true,
    });
    expect(
      await verifiedPublisherAuto.resolveForPlugin('com.example.verified', 'fixture', {
        headless: true,
      })
    ).toMatchObject({ status: 'resolved', source: 'managed' });
  });

  it('keeps legacy plugins without a compatibility descriptor on the old path', async () => {
    const runtimeService = await service({ path: '' });
    expect(await runtimeService.resolveForRuntime('legacy-runtime')).toBeUndefined();
  });
});

describe('ManagedRuntimeService secure installation', () => {
  it('installs a verified CLI atomically and preserves host authentication environment', async () => {
    const bytes = fakeCli('1.2.3');
    const http = await fixtureServer({ '/fixture': bytes });
    const runtimeService = await service({ path: '', mirrorOrigin: http.origin });
    registerCatalog(runtimeService, descriptor(artifact(`${http.origin}/fixture`, bytes)));

    const beforeEnv = { HOME: process.env.HOME, token: process.env.OFFICIAL_FAKE_TOKEN };
    const result = await runtimeService.installForPlugin({
      pluginId: 'com.example.fixture',
      pluginVersion: '1.0.0',
      runtime: 'fixture',
      approved: true,
      pin: true,
    });
    expect(result).toMatchObject({
      status: 'resolved',
      source: 'managed',
      authState: 'authenticated',
      verification: {
        checksumVerified: true,
        sha256: sha256(bytes),
        size: bytes.length,
      },
    });
    expect(await readFile(result.executablePath!, 'utf8')).toContain('OFFICIAL_FAKE_TOKEN');
    expect({ HOME: process.env.HOME, token: process.env.OFFICIAL_FAKE_TOKEN }).toEqual(beforeEnv);
    expect(result.verification.storagePath).toContain(
      path.join('runtime-store', 'fixture', '1.2.3', 'linux-x64')
    );
  });

  it('verifies optional signatures and artifact-bound provenance', async () => {
    const bytes = fakeCli('1.2.3');
    const predicateType = 'https://slsa.dev/provenance/v1';
    const provenance = Buffer.from(
      JSON.stringify({
        predicateType,
        subject: [{ digest: { sha256: sha256(bytes) } }],
      })
    );
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const http = await fixtureServer({ '/fixture': bytes, '/provenance': provenance });
    const signedArtifact: ManagedRuntimeArtifact = {
      ...artifact(`${http.origin}/fixture`, bytes),
      signature: {
        algorithm: 'ed25519',
        publicKey: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
        value: sign(null, bytes, privateKey).toString('base64'),
      },
      provenance: {
        url: `${http.origin}/provenance`,
        sha256: sha256(provenance),
        predicateType,
      },
    };
    const runtimeService = await service({ path: '', mirrorOrigin: http.origin });
    registerCatalog(runtimeService, descriptor(signedArtifact));

    const result = await runtimeService.installForPlugin({
      pluginId: 'com.example.fixture',
      pluginVersion: '1.0.0',
      runtime: 'fixture',
      approved: true,
    });
    expect(result.verification).toMatchObject({
      checksumVerified: true,
      signatureVerified: true,
      provenanceVerified: true,
    });
  });

  it('rejects provenance that is not bound to the downloaded artifact', async () => {
    const bytes = fakeCli('1.2.3');
    const provenance = Buffer.from(
      JSON.stringify({ subject: [{ digest: { sha256: '0'.repeat(64) } }] })
    );
    const http = await fixtureServer({ '/fixture': bytes, '/provenance': provenance });
    const runtimeArtifact: ManagedRuntimeArtifact = {
      ...artifact(`${http.origin}/fixture`, bytes),
      provenance: {
        url: `${http.origin}/provenance`,
        sha256: sha256(provenance),
      },
    };
    const runtimeService = await service({ path: '', mirrorOrigin: http.origin });
    registerCatalog(runtimeService, descriptor(runtimeArtifact));

    await expect(
      runtimeService.installForPlugin({
        pluginId: 'com.example.fixture',
        pluginVersion: '1.0.0',
        runtime: 'fixture',
        approved: true,
      })
    ).rejects.toThrow(/does not bind/i);
    expect(await readdir(runtimeService.stagingDir).catch(() => [])).toEqual([]);
  });

  it('returns auth-required without copying or rewriting tokens', async () => {
    const bytes = fakeCli('1.2.3');
    const http = await fixtureServer({ '/fixture': bytes });
    const runtimeService = await service({
      path: '',
      mirrorOrigin: http.origin,
      token: 'not-authenticated',
    });
    registerCatalog(runtimeService, descriptor(artifact(`${http.origin}/fixture`, bytes)));
    const result = await runtimeService.installForPlugin({
      pluginId: 'com.example.fixture',
      pluginVersion: '1.0.0',
      runtime: 'fixture',
      approved: true,
    });
    expect(result).toMatchObject({ status: 'auth-required', authState: 'auth-required' });
    expect(result.message).toMatch(/official login flow/i);
  });

  it('rejects SHA-256 mismatches and leaves no half-installed directory', async () => {
    const bytes = fakeCli('1.2.3');
    const http = await fixtureServer({ '/fixture': bytes });
    const runtimeService = await service({ path: '', mirrorOrigin: http.origin });
    const bad = { ...artifact(`${http.origin}/fixture`, bytes), sha256: '0'.repeat(64) };
    registerCatalog(runtimeService, descriptor(bad));
    await expect(
      runtimeService.installForPlugin({
        pluginId: 'com.example.fixture',
        pluginVersion: '1.0.0',
        runtime: 'fixture',
        approved: true,
      })
    ).rejects.toThrow(/SHA-256 mismatch/i);
    expect(
      await readdir(path.join(runtimeService.storeDir, 'fixture'), { recursive: true }).catch(
        () => []
      )
    ).toEqual([]);
    expect(await readdir(runtimeService.stagingDir).catch(() => [])).toEqual([]);
  });

  it('keeps the previous pinned runtime when an update installation fails', async () => {
    const v1 = fakeCli('1.2.3');
    const v2 = fakeCli('1.2.4');
    const http = await fixtureServer({ '/v1': v1, '/v2': v2 });
    const runtimeService = await service({ path: '', mirrorOrigin: http.origin });
    registerCatalog(
      runtimeService,
      descriptor(undefined, {
        versions: [
          { version: '1.2.3', artifact: artifact(`${http.origin}/v1`, v1) },
          {
            version: '1.2.4',
            artifact: {
              ...artifact(`${http.origin}/v2`, v2),
              sha256: '0'.repeat(64),
            },
          },
        ],
      })
    );
    await runtimeService.installForPlugin({
      pluginId: 'com.example.fixture',
      pluginVersion: '1.0.0',
      runtime: 'fixture',
      version: '1.2.3',
      approved: true,
      pin: true,
    });

    await expect(
      runtimeService.installForPlugin({
        pluginId: 'com.example.fixture',
        pluginVersion: '1.0.0',
        runtime: 'fixture',
        version: '1.2.4',
        approved: true,
        pin: true,
      })
    ).rejects.toThrow(/SHA-256 mismatch/i);
    expect(
      await runtimeService.resolveForPlugin('com.example.fixture', 'fixture', { headless: true })
    ).toMatchObject({ status: 'resolved', source: 'managed', version: '1.2.3' });
    expect((await runtimeService.listStatuses())[0].selectedVersion).toBe('1.2.3');
  });

  it('rejects ZIP traversal and dangerous symlink entries', async () => {
    const traversal = buildZip([
      { name: '../escape', data: 'bad' },
      { name: 'bin/fixture', data: fakeCli('1.2.3'), mode: 0o100755 },
    ]).buffer;
    const symlink = buildZip([
      { name: 'bin/real', data: fakeCli('1.2.3'), mode: 0o100755 },
      symlinkEntry('bin/fixture', 'real'),
    ]).buffer;
    const http = await fixtureServer({ '/traversal': traversal, '/symlink': symlink });

    for (const [name, bytes] of [
      ['traversal', traversal],
      ['symlink', symlink],
    ] as const) {
      const runtimeService = await service({ path: '', mirrorOrigin: http.origin });
      registerCatalog(
        runtimeService,
        descriptor(artifact(`${http.origin}/${name}`, bytes, 'zip')),
        `com.example.${name}`
      );
      await expect(
        runtimeService.installForPlugin({
          pluginId: `com.example.${name}`,
          pluginVersion: '1.0.0',
          runtime: 'fixture',
          approved: true,
        })
      ).rejects.toThrow(name === 'traversal' ? /unsafe archive path/i : /may not contain links/i);
    }
  });

  it('removes interrupted downloads and serializes concurrent installation', async () => {
    const bytes = fakeCli('1.2.3');
    const interruptedHttp = await fixtureServer({
      '/fixture': { body: bytes, contentLength: bytes.length, interrupt: true },
    });
    const interruptedService = await service({
      path: '',
      mirrorOrigin: interruptedHttp.origin,
    });
    registerCatalog(
      interruptedService,
      descriptor(artifact(`${interruptedHttp.origin}/fixture`, bytes))
    );
    await expect(
      interruptedService.installForPlugin({
        pluginId: 'com.example.fixture',
        pluginVersion: '1.0.0',
        runtime: 'fixture',
        approved: true,
      })
    ).rejects.toThrow();
    expect(await readdir(interruptedService.stagingDir).catch(() => [])).toEqual([]);

    const http = await fixtureServer({ '/fixture': bytes });
    const concurrentService = await service({ path: '', mirrorOrigin: http.origin });
    registerCatalog(concurrentService, descriptor(artifact(`${http.origin}/fixture`, bytes)));
    const installs = await Promise.all(
      Array.from({ length: 5 }, () =>
        concurrentService.installForPlugin({
          pluginId: 'com.example.fixture',
          pluginVersion: '1.0.0',
          runtime: 'fixture',
          approved: true,
        })
      )
    );
    expect(new Set(installs.map(item => item.executablePath)).size).toBe(1);
    expect(http.requests()).toBe(1);
  });

  it('supports selection rollback, shared references, and reference-safe garbage collection', async () => {
    const v1 = fakeCli('1.2.3');
    const v2 = fakeCli('1.2.4');
    const http = await fixtureServer({ '/v1': v1, '/v2': v2 });
    const config = descriptor(undefined, {
      versions: [
        { version: '1.2.3', artifact: artifact(`${http.origin}/v1`, v1) },
        { version: '1.2.4', artifact: artifact(`${http.origin}/v2`, v2) },
      ],
    });
    const runtimeService = await service({ path: '', mirrorOrigin: http.origin });
    registerCatalog(runtimeService, config, 'com.example.one');
    registerCatalog(runtimeService, config, 'com.example.two');

    await runtimeService.installForPlugin({
      pluginId: 'com.example.one',
      pluginVersion: '1.0.0',
      runtime: 'fixture',
      version: '1.2.3',
      approved: true,
    });
    await runtimeService.installForPlugin({
      pluginId: 'com.example.one',
      pluginVersion: '1.0.0',
      runtime: 'fixture',
      version: '1.2.4',
      approved: true,
    });
    expect(
      await runtimeService.resolveForPlugin('com.example.two', 'fixture', { headless: true })
    ).toMatchObject({ status: 'resolved', source: 'managed', version: '1.2.4' });
    expect(http.requests()).toBe(2);

    await runtimeService.rollbackReference('com.example.one', '1.0.0', 'fixture');
    const statuses = await runtimeService.listStatuses();
    expect(statuses.find(item => item.pluginId === 'com.example.one')?.selectedVersion).toBe(
      '1.2.3'
    );

    await runtimeService.releasePluginReference('com.example.one', '1.0.0');
    expect((await runtimeService.garbageCollect({ graceMs: 0 })).removed).toEqual([
      expect.stringContaining(path.join('fixture', '1.2.3', 'linux-x64')),
    ]);
    await runtimeService.releasePluginReference('com.example.two', '1.0.0');
    expect((await runtimeService.garbageCollect({ graceMs: 0 })).removed).toEqual([
      expect.stringContaining(path.join('fixture', '1.2.4', 'linux-x64')),
    ]);
  });

  it('reuses a version only when the declaring plugins agree on its trusted digest', async () => {
    const original = fakeCli('1.2.3');
    const different = Buffer.concat([fakeCli('1.2.3'), Buffer.from('\n// different artifact\n')]);
    const http = await fixtureServer({ '/original': original, '/different': different });
    const runtimeService = await service({ path: '', mirrorOrigin: http.origin });
    registerCatalog(
      runtimeService,
      descriptor(artifact(`${http.origin}/original`, original)),
      'com.example.one'
    );
    registerCatalog(
      runtimeService,
      descriptor(artifact(`${http.origin}/different`, different)),
      'com.example.two'
    );
    await runtimeService.installForPlugin({
      pluginId: 'com.example.one',
      pluginVersion: '1.0.0',
      runtime: 'fixture',
      approved: true,
    });

    expect(
      await runtimeService.resolveForPlugin('com.example.two', 'fixture', { headless: true })
    ).toMatchObject({
      status: 'needs-approval',
      artifact: { sha256: sha256(different) },
    });
    await expect(
      runtimeService.installForPlugin({
        pluginId: 'com.example.two',
        pluginVersion: '1.0.0',
        runtime: 'fixture',
        approved: true,
      })
    ).rejects.toThrow(/different trusted artifact digest/i);
    expect(http.requests()).toBe(1);
  });
});
