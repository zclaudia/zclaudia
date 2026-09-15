import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  AgentRuntimeHarness,
  openCodingSession,
  sendCodingMessage,
} from '../../helpers/agent-runtime-harness';
import { runLiveCancellationProbe } from '../../helpers/live-cancellation-probe';
import { runLiveCapabilitiesProbe } from '../../helpers/live-capabilities-probe';
import { prepareRecordedLiveCli } from '../../helpers/live-cli-setup';
import { runLiveConcurrencyProbe } from '../../helpers/live-concurrency-probe';

const options = JSON.parse(await readFile(process.env.ZCLAUDIA_RUNTIME_LIVE_INPUT!, 'utf8'));
const root = path.resolve(import.meta.dirname, '../../..');
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

test(`${options.coveredCases.join('/')}: ${options.runtime} real application ${options.scenario}`, async ({
  page,
  context,
}) => {
  const app = new AgentRuntimeHarness();
  app.directory = await realpath(await mkdtemp(path.join(tmpdir(), 'zclaudia-live-')));
  const accountRoot = options.selfTest
    ? path.join(app.directory, 'test-account')
    : options.accountRoot;
  const evidence: Record<string, any> = {
    mode: options.selfTest ? 'runner-self-test-with-cli-fixtures' : 'real-cli',
    coveredCases: options.coveredCases,
    uncoveredCases: options.uncoveredCases,
    runtime: options.runtime,
    turns: [],
    status: 'failed',
  };
  let phase = 'prepare';
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let watchdogShutdown: Promise<void> | undefined;
  let watchdogError: unknown;
  let primaryFailure: unknown;
  let cleanupFailure: unknown;
  try {
    if (options.selfTest)
      for (const name of [
        'home',
        options.runtime,
        ...(options.peerRuntime ? [options.peerRuntime] : []),
      ])
        await mkdir(path.join(accountRoot, name), { recursive: true });
    app.runtimeEnvironment = {
      HOME: path.join(accountRoot, 'home'),
      USERPROFILE: path.join(accountRoot, 'home'),
      XDG_CONFIG_HOME: path.join(accountRoot, 'home/.config'),
      ZCLAUDIA_AGENT_CONFIG_ROOT: accountRoot,
      ...([options.runtime, options.peerRuntime].includes('claude')
        ? { CLAUDE_CONFIG_DIR: path.join(accountRoot, 'claude') }
        : {}),
      ...([options.runtime, options.peerRuntime].includes('codex')
        ? { CODEX_HOME: path.join(accountRoot, 'codex') }
        : {}),
    };
    const primaryCli = await prepareRecordedLiveCli(
      app,
      options.runtime,
      options.cliPath,
      options.selfTest,
      options.model
    );
    const shim = primaryCli.shim;
    Object.assign(evidence, primaryCli.metadata);
    evidence.serverEntrySha256 = hash(await readFile(path.join(root, 'server/dist/index.js')));
    const peerCli = options.peerRuntime
      ? await prepareRecordedLiveCli(
          app,
          options.peerRuntime,
          options.peerCliPath,
          options.selfTest,
          options.peerModel
        )
      : undefined;
    if (peerCli) evidence.runtimes = [primaryCli.metadata, peerCli.metadata];
    phase = 'start';
    await app.start();
    for (const llm of await app.api('/api/llm-profiles'))
      await app.api(`/api/llm-profiles/${llm.id}`, { method: 'DELETE' });
    const targetProfile = (await app.api('/api/agent-profiles')).find(
      (profile: any) => profile.runtimeType === options.runtime
    );
    expect(targetProfile).toBeTruthy();
    if (options.model)
      await app.api(`/api/agent-profiles/${targetProfile.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ model: options.model }),
      });
    phase = 'create-project-through-ui';
    const { project, session, profile, cwd } = await app.configureCodingProject(
      options.runtime,
      page,
      '-live',
      shim
    );
    expect(await app.api('/api/llm-profiles')).toEqual([]);
    const testFile = path.join(cwd, 'add.test.mjs');
    const testSource = `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { writeFileSync } from 'node:fs';\nimport { add } from './add.mjs';\ntest('addition', () => { assert.equal(add(2, 3), 5); assert.equal(add(-2, 3), 1); writeFileSync('test-result.json', JSON.stringify({ passed: true, cwd: process.cwd(), node: process.version })); });\n`;
    await writeFile(testFile, testSource);
    execFileSync('git', ['init', '--quiet'], { cwd });
    execFileSync('git', ['add', 'add.mjs', 'add.test.mjs'], { cwd });
    evidence.profileId = profile.id;
    evidence.sessionId = session.id;
    if (options.scenario === 'capabilities') {
      phase = 'capabilities';
      await runLiveCapabilitiesProbe(
        page,
        app,
        { project, session, profile, cwd },
        options,
        evidence
      );
      evidence.status = 'passed';
      return;
    }
    if (options.scenario === 'concurrency') {
      phase = 'create-peer-project';
      expect(peerCli).toBeTruthy();
      const peerProfile = (await app.api('/api/agent-profiles')).find(
        (item: any) => item.runtimeType === options.peerRuntime
      );
      expect(peerProfile).toBeTruthy();
      if (options.peerModel)
        await app.api(`/api/agent-profiles/${peerProfile.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ model: options.peerModel }),
        });
      const peerPage = await context.newPage();
      const peer = await app.configureCodingProject(
        options.peerRuntime,
        peerPage,
        '-live-peer',
        peerCli!.shim
      );
      phase = 'concurrency';
      await runLiveConcurrencyProbe(
        page,
        peerPage,
        app,
        { project, session, profile, cwd },
        peer,
        options,
        evidence
      );
      evidence.status = 'passed';
      return;
    }
    const initialSdkSession = (await app.api(`/api/sessions/${session.id}`)).sdkSessionId;
    let sdkSessionId: string | undefined;
    const firstCodingTurn = options.scenario === 'cancel' ? 2 : 1;
    if (options.scenario === 'cancel') {
      phase = 'cancel-turn-1';
      watchdog = setTimeout(() => {
        evidence.timedOutTurn = 1;
        watchdogShutdown = app.stop().catch(error => {
          watchdogError = error;
        });
      }, options.turnTimeoutMs);
      evidence.cancellation = await runLiveCancellationProbe(
        page,
        app,
        project,
        session,
        cwd,
        options
      );
      if (evidence.timedOutTurn) throw new Error('Live cancellation deadline exceeded');
      clearTimeout(watchdog);
      watchdog = undefined;
      sdkSessionId = (await app.api(`/api/sessions/${session.id}`)).sdkSessionId;
      expect(typeof sdkSessionId).toBe('string');
      expect(sdkSessionId!.length).toBeGreaterThan(0);
    }
    for (let turn = firstCodingTurn; turn <= options.maxTurns; turn++) {
      phase = `coding-turn-${turn}`;
      if (turn > options.maxTurns) throw new Error('User-turn limit exceeded');
      if (turn === 3) {
        await app.restart();
        expect((await app.api(`/api/sessions/${session.id}`)).sdkSessionId).toBe(sdkSessionId);
      }
      await rm(path.join(cwd, 'test-result.json'), { force: true });
      await openCodingSession(page, app, project, session);
      const previous = await app.api(`/api/sessions/${session.id}/messages?limit=100`);
      const previousOffset = previous.pagination.maxOffset ?? 0;
      const started = Date.now();
      watchdog = setTimeout(() => {
        evidence.timedOutTurn = turn;
        watchdogShutdown = app.stop().catch(error => {
          watchdogError = error;
        });
      }, options.turnTimeoutMs);
      await sendCodingMessage(
        page,
        options.selfTest && options.selfTestFault === 'turn-timeout'
          ? 'E2E_WAIT_FOR_CANCEL'
          : `${turn === firstCodingTurn ? 'Read add.mjs and fix addition by replacing a - b with a + b. Change only add.mjs.' : 'Continue this same coding session; keep the corrected addition function unchanged.'} Run ${quote(process.execPath)} --test add.test.mjs and report the outcome. Do not edit the test, access account configuration, read environment variables, or access the network. Work only inside this project.`
      );
      let messages: any[] = [];
      let approvals = 0;
      while (Date.now() - started < options.turnTimeoutMs) {
        const allow = page.getByRole('button', { name: 'Allow', exact: true });
        if (await allow.count()) {
          if (++approvals > 12) throw new Error('Approval count limit exceeded');
          await allow.first().click();
        }
        const state = await app.api(`/api/sessions/${session.id}/run-state`);
        messages = [];
        let offset = previousOffset;
        for (let batch = 0; batch < 20; batch++) {
          const page = await app.api(
            `/api/sessions/${session.id}/messages?limit=100&afterOffset=${offset}`
          );
          messages.push(...page.messages);
          if (!page.pagination.hasMore) break;
          if (page.pagination.maxOffset <= offset || batch === 19)
            throw new Error('Message evidence pagination did not complete');
          offset = page.pagination.maxOffset;
        }
        if (!state.isRunning && messages.some(message => message.role === 'assistant')) break;
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      expect((await app.api(`/api/sessions/${session.id}/run-state`)).isRunning).toBe(false);
      expect(messages.some(message => message.role === 'assistant' && message.content.trim())).toBe(
        true
      );
      expect(messages.some(message => message.metadata?.toolCalls?.length)).toBe(true);
      expect(await readFile(testFile, 'utf8')).toBe(testSource);
      expect(JSON.parse(await readFile(path.join(cwd, 'test-result.json'), 'utf8'))).toMatchObject({
        passed: true,
        cwd,
      });
      const fixed = await readFile(path.join(cwd, 'add.mjs'), 'utf8');
      expect(fixed).toBe('export const add = (a, b) => a + b;\n');
      execFileSync(process.execPath, ['--test', 'add.test.mjs'], {
        cwd,
        stdio: 'pipe',
        timeout: 10_000,
      });
      const persisted = await app.api(`/api/sessions/${session.id}`);
      expect(persisted.agentProfileId).toBe(profile.id);
      expect(typeof persisted.sdkSessionId).toBe('string');
      expect(persisted.sdkSessionId.length).toBeGreaterThan(0);
      if (sdkSessionId) expect(persisted.sdkSessionId).toBe(sdkSessionId);
      sdkSessionId = persisted.sdkSessionId;
      if (evidence.timedOutTurn) throw new Error('Live turn deadline exceeded');
      clearTimeout(watchdog);
      watchdog = undefined;
      evidence.turns.push({
        turn,
        durationMs: Date.now() - started,
        approvals,
        sdkSessionId,
        model: messages.find(message => message.metadata?.model)?.metadata.model ?? null,
        toolCount: messages.reduce(
          (count, message) => count + (message.metadata?.toolCalls?.length ?? 0),
          0
        ),
        reportedUsage: messages.flatMap(message => {
          const usage = message.metadata?.usage;
          if (!usage) return [];
          const number = (value: unknown) =>
            typeof value === 'number' && Number.isFinite(value) ? value : null;
          return [
            {
              input: number(usage.input),
              output: number(usage.output),
              totalTokens: number(usage.totalTokens),
              costTotal: number(usage.cost?.total),
            },
          ];
        }),
        testPassed: true,
        fileSha256: hash(fixed),
      });
    }
    evidence.initialSdkSessionId = initialSdkSession ?? null;
    evidence.diff = execFileSync('git', ['diff', '--', 'add.mjs'], { cwd, encoding: 'utf8' });
    expect(evidence.diff).toContain('+export const add = (a, b) => a + b;');
    phase = 'shutdown';
    await app.stop();
    evidence.processes = (await app.audit()).filter(row => row.boundary);
    expect(
      evidence.processes.some((row: any) => row.boundary === 'cli' && row.event === 'started')
    ).toBe(true);
    evidence.processCleanup = 'passed';
    evidence.status = 'passed';
  } catch (error) {
    evidence.failurePhase = phase;
    // Remembered so the cleanup below can tell "the run failed" from "only
    // cleanup failed" and avoid replacing the real cause with its own error.
    primaryFailure = error;
    if (options.selfTest) throw error;
    // Do not leak provider stderr, request URLs or account data into reporters.
    throw new Error(
      `Real CLI acceptance failed during ${phase}; see acceptance-evidence.json. Raw provider output is excluded.`
    );
  } finally {
    clearTimeout(watchdog);
    await watchdogShutdown;
    const recordCleanupFailure = (error: unknown) => {
      evidence.status = 'failed';
      evidence.processCleanup = 'failed';
      evidence.cleanupFailure = String(error);
      if (primaryFailure || cleanupFailure) return;
      cleanupFailure = options.selfTest
        ? error
        : new Error('Live CLI process cleanup failed; acceptance did not pass');
    };
    try {
      // Collect cleanup evidence on failures too, before dispose removes the
      // owned workspace. Cleanup success never turns a failed task into a pass.
      await app.stop();
      await app.assertFixtureProcessesStopped();
      evidence.processes = (
        await app.audit().catch(error => {
          if (error.code === 'ENOENT') return [];
          throw error;
        })
      ).filter(row => row.boundary);
      evidence.processCleanup = 'passed';
      if (watchdogError) recordCleanupFailure(watchdogError);
    } catch (error) {
      recordCleanupFailure(error);
    } finally {
      try {
        await app.dispose();
      } catch (error) {
        evidence.disposalFailure = String(error);
        recordCleanupFailure(error);
      } finally {
        await writeFile(
          path.join(options.outputDirectory, 'acceptance-evidence.json'),
          JSON.stringify(evidence, null, 2),
          { mode: 0o600 }
        );
      }
    }
  }
  // Only reachable when the run itself passed: a failing run has already been
  // rethrown from the catch above. Cleanup failure still fails the task, it
  // just no longer overwrites the reason a real failure happened.
  if (cleanupFailure) throw cleanupFailure;
});
