import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  FullConfig,
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';

export default class AgentRuntimeReporter implements Reporter {
  private readonly results: Array<{
    name: string;
    status: string;
    durationMs: number;
    retry: number;
  }> = [];
  constructor(private readonly options: { artifactRoot: string }) {}
  private acceptanceMode?: string;

  onBegin(config: FullConfig) {
    this.acceptanceMode = config.metadata.acceptanceMode;
  }

  onTestEnd(test: TestCase, result: TestResult) {
    this.results.push({
      name: test.title,
      status: result.status,
      durationMs: result.duration,
      retry: result.retry,
    });
  }

  onEnd(result: FullResult) {
    const root = path.resolve(import.meta.dirname, '../..');
    const git = (args: string[]) =>
      execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    const artifactDirectory =
      this.acceptanceMode === 'mutable-artifact-fixtures'
        ? path.resolve(
            process.env.ZCLAUDIA_E2E_MUTABLE_ARTIFACT_DIR ?? path.join(root, 'server/bundle')
          )
        : process.env.ZCLAUDIA_E2E_SERVER_ENTRY
          ? path.dirname(process.env.ZCLAUDIA_E2E_SERVER_ENTRY)
          : undefined;
    let catalog:
      | {
          sourceCommit: string;
          sourceDirty: boolean;
          plugins: Array<{ id: string; version: string; treeSha256: string }>;
        }
      | undefined;
    let artifactBaseline: Record<string, unknown> | undefined;
    if (artifactDirectory) {
      try {
        const catalogBytes = readFileSync(
          path.join(artifactDirectory, 'builtin-plugins/catalog.json')
        );
        catalog = JSON.parse(catalogBytes.toString());
        artifactBaseline = {
          sourceCommit: catalog!.sourceCommit,
          sourceDirty: catalog!.sourceDirty,
          serverSha256: createHash('sha256')
            .update(readFileSync(path.join(artifactDirectory, 'server.mjs')))
            .digest('hex'),
          catalogSha256: createHash('sha256').update(catalogBytes).digest('hex'),
          mutatedCopies: this.acceptanceMode === 'mutable-artifact-fixtures',
        };
      } catch (error) {
        // Preserve the test failure report even when the input artifact is missing.
        artifactBaseline = { error: error instanceof Error ? error.message : String(error) };
      }
    }
    const plugins = catalog
      ? catalog.plugins.map(({ id, version, treeSha256 }: any) => ({ id, version, treeSha256 }))
      : artifactDirectory
        ? []
        : ['claude', 'codex', 'cursor'].map(runtime => {
            const manifest = JSON.parse(
              readFileSync(path.join(root, 'plugins/agents', runtime, 'plugin.json'), 'utf8')
            );
            return { id: manifest.id, version: manifest.version };
          });
    mkdirSync(this.options.artifactRoot, { recursive: true });
    writeFileSync(
      path.join(this.options.artifactRoot, 'summary.json'),
      JSON.stringify(
        {
          status: result.status,
          mode:
            this.acceptanceMode ??
            (process.env.ZCLAUDIA_E2E_SERVER_ENTRY
              ? 'packaged-server-with-cli-fixtures'
              : 'full-application-with-cli-fixtures'),
          sourceCommit: git(['rev-parse', 'HEAD']),
          sourceDirty: !!git(['status', '--porcelain']),
          platform: process.platform,
          arch: process.arch,
          nodeVersion: process.version,
          startedAt: result.startTime.toISOString(),
          durationMs: result.duration,
          plugins,
          artifactBaseline,
          tests: this.results,
        },
        null,
        2
      )
    );
  }
}
