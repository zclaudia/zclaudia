// Credential-free acceptance of the live driver, not vendor CLI certification.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2).filter(value => value !== '--');
if (args.length && (args.length !== 2 || args[0] !== '--output-dir'))
  throw new Error('Usage: test-builtin-runtime-live-selftest.mjs [--output-dir <new-directory>]');
const directory = path.resolve(
  args[1] ??
    path.join(
      root,
      'artifacts/agent-runtime-migration',
      `live-selftest-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`
    )
);
await mkdir(path.dirname(directory), { recursive: true });
await mkdir(directory, { mode: 0o700 });
const evidence = { mode: 'live-driver-self-test-only', status: 'failed', results: [] };
try {
  for (const runtime of ['claude', 'codex', 'cursor']) {
    for (const scenario of ['coding', 'deadline', 'cancel', 'capabilities', 'concurrency']) {
      const fault = scenario === 'deadline';
      const output = path.join(directory, `${runtime}-${scenario}`);
      const result = spawnSync(
        process.execPath,
        [
          path.join(root, 'scripts/dev/test-builtin-runtime-live.mjs'),
          '--runtime',
          runtime,
          '--self-test',
          '--output-dir',
          output,
          ...(['cancel', 'capabilities', 'concurrency'].includes(scenario)
            ? ['--scenario', scenario]
            : []),
          ...(scenario === 'concurrency'
            ? ['--peer-runtime', { claude: 'codex', codex: 'cursor', cursor: 'claude' }[runtime]]
            : []),
          ...(fault ? ['--self-test-fault', 'turn-timeout', '--turn-timeout-ms', '3000'] : []),
        ],
        { cwd: root, env: process.env, stdio: 'inherit', timeout: 120_000 }
      );
      if (result.error) throw result.error;
      assert.equal(result.signal, null);
      assert.equal(result.status, fault ? 1 : 0);
      const report = JSON.parse(
        await readFile(path.join(output, 'acceptance-evidence.json'), 'utf8')
      );
      const runner = JSON.parse(await readFile(path.join(output, 'runner-result.json'), 'utf8'));
      assert.equal(report.mode, 'runner-self-test-with-cli-fixtures');
      assert.equal(report.runtime, runtime);
      assert.equal(report.processCleanup, 'passed');
      assert.ok(report.processes.some(row => row.boundary === 'cli' && row.event === 'started'));
      assert.equal(runner.selfTest, true);
      assert.equal(runner.status, fault ? 'failed' : 'passed');
      assert.equal(report.status, fault ? 'failed' : 'passed');
      await assert.rejects(stat(path.join(output, 'test-results')), { code: 'ENOENT' });
      if (fault) {
        assert.equal(report.timedOutTurn, 1);
        assert.equal(report.failurePhase, 'coding-turn-1');
        assert.equal(report.turns.length, 0);
      } else if (scenario === 'concurrency') {
        assert.deepEqual(report.coveredCases, ['L06']);
        assert.equal(report.runtimes.length, 2);
        assert.equal(report.concurrency.status, 'passed');
        assert.equal(report.concurrency.overlapped, true);
        assert.equal(report.concurrency.peerCompleted, true);
        assert.equal(report.concurrency.peerContinuedWriting, true);
        assert.equal(report.concurrency.outputsIsolated, true);
        assert.equal(report.concurrency.sessionReceiptsVerified, 2);
        assert.notEqual(
          report.concurrency.primarySdkSessionId,
          report.concurrency.peerSdkSessionId
        );
        assert.equal(
          report.concurrency.approvalIsolation,
          report.concurrency.peerRuntime === 'cursor'
            ? 'not-supported-by-peer'
            : 'pending-survived-other-session-cancel'
        );
      } else if (scenario === 'capabilities') {
        assert.deepEqual(report.coveredCases, ['L05']);
        assert.equal(report.capabilities.length, 3);
        assert.ok(report.capabilities.every(row => row.status === 'passed'));
        assert.equal(new Set(report.capabilities.map(row => row.sdkSessionId)).size, 1);
        assert.equal(report.capabilities[2].kind, 'mcp');
        assert.equal(report.capabilities[2].hostReceiptVerified, true);
        assert.ok(report.capabilities[2].verifiedCalls > 0);
        if (runtime === 'cursor') {
          assert.deepEqual(
            report.capabilities.slice(0, 2).map(row => row.mode),
            ['plan', 'ask']
          );
          assert.ok(
            report.capabilities.slice(0, 2).every(row => row.filesUnchanged && row.approvals === 0)
          );
        } else {
          assert.deepEqual(
            report.capabilities.slice(0, 2).map(row => row.decision),
            ['allow', 'deny']
          );
          assert.deepEqual(
            report.capabilities.slice(0, 2).map(row => row.sideEffectPresent),
            [true, false]
          );
          assert.ok(report.capabilities.slice(0, 2).every(row => row.approvals > 0));
        }
      } else {
        assert.equal(report.turns.length, scenario === 'cancel' ? 1 : 3);
        assert.equal(new Set(report.turns.map(turn => turn.sdkSessionId)).size, 1);
        assert.ok(report.turns.every(turn => turn.testPassed && turn.toolCount > 0));
        if (runtime === 'claude') assert.match(report.sdkVersion, /^\d+\.\d+\.\d+/);
        if (scenario === 'cancel') {
          assert.deepEqual(report.coveredCases, ['L04']);
          assert.equal(report.cancellation.status, 'passed');
          assert.equal(report.cancellation.writesStopped, true);
          assert.equal(report.cancellation.writerBoundary, 'fixture-cli');
          assert.equal(report.cancellation.postCancelObservationMs, 3000);
          assert.equal(report.turns[0].turn, 2);
        }
      }
      evidence.results.push({
        runtime,
        case: fault
          ? 'deadline-and-cleanup'
          : scenario === 'cancel'
            ? 'cancel-and-next-turn'
            : scenario === 'capabilities'
              ? 'approval-modes-and-mcp'
              : scenario === 'concurrency'
                ? 'cross-runtime-cancel-and-complete'
                : 'coding-and-recovery',
        expectedAcceptanceStatus: fault ? 'failed' : 'passed',
        status: 'passed',
        report: output,
      });
    }
  }
  evidence.status = 'passed';
} finally {
  await writeFile(
    path.join(directory, 'self-test-summary.json'),
    JSON.stringify(evidence, null, 2),
    { mode: 0o600 }
  );
  console.log(
    `Live driver self-test ${evidence.status}: ${directory}. No real CLI acceptance performed.`
  );
}
