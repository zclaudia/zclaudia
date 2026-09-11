import { mkdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import {
  LIVE_HELP,
  parseLiveOptions,
  validateLivePaths,
  validateLiveEnvironment,
} from './agent-runtime-live-options.mjs';

if (process.argv.includes('--help')) {
  console.log(LIVE_HELP);
} else {
  try {
    validateLiveEnvironment(process.env);
    const options = await validateLivePaths(parseLiveOptions(process.argv.slice(2)));
    if (options.validateOnly) {
      console.log(
        JSON.stringify({
          status: 'validated',
          runtime: options.runtime,
          cliExecuted: false,
          coveredCases: options.coveredCases,
        })
      );
    } else {
      await mkdir(path.dirname(options.outputDirectory), { recursive: true });
      await mkdir(options.outputDirectory, { mode: 0o700 });
      const input = path.join(options.outputDirectory, 'acceptance-input.json');
      await writeFile(input, JSON.stringify(options, null, 2), { mode: 0o600 });
      const root = path.resolve(import.meta.dirname, '../..');
      const child = spawn(
        'pnpm',
        ['exec', 'playwright', 'test', '--config', 'e2e/playwright.agent-runtime-live.config.ts'],
        {
          cwd: root,
          env: { ...process.env, ZCLAUDIA_RUNTIME_LIVE_INPUT: input },
          stdio: 'inherit',
          detached: true,
        }
      );
      let interrupted = false;
      let escalation;
      const terminateGroup = signal => {
        if (!child.pid) return;
        try {
          process.kill(-child.pid, signal);
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      };
      const interrupt = () => {
        interrupted = true;
        terminateGroup('SIGTERM');
        escalation ??= setTimeout(() => terminateGroup('SIGKILL'), 3000);
      };
      process.on('SIGINT', interrupt);
      process.on('SIGTERM', interrupt);
      const deadline = setTimeout(interrupt, options.turnTimeoutMs * options.maxTurns + 120_000);
      let code = 1;
      try {
        code = await new Promise((resolve, reject) => {
          child.once('error', reject);
          child.once('exit', (code, signal) => resolve(signal || interrupted ? 1 : (code ?? 1)));
        });
      } finally {
        clearTimeout(deadline);
        if (interrupted) {
          // Give the CLI launchers time to escalate their own detached groups.
          await new Promise(resolve => setTimeout(resolve, 1500));
          terminateGroup('SIGKILL');
        }
        clearTimeout(escalation);
        process.off('SIGINT', interrupt);
        process.off('SIGTERM', interrupt);
        // A killed worker may not reach Playwright's preserveOutput cleanup.
        // This directory was created for this invocation and contains no user files.
        await rm(path.join(options.outputDirectory, 'test-results'), {
          recursive: true,
          force: true,
        });
        await writeFile(
          path.join(options.outputDirectory, 'runner-result.json'),
          JSON.stringify(
            {
              status: code === 0 ? 'passed' : interrupted ? 'interrupted' : 'failed',
              selfTest: options.selfTest,
              exitCode: code,
              coveredCases: options.coveredCases,
              uncoveredCases: options.uncoveredCases,
            },
            null,
            2
          )
        );
      }
      process.exitCode = code;
      console.log(
        `Runtime acceptance ${code === 0 ? 'passed' : 'failed'} (${options.selfTest ? 'CLI fixtures; not live' : 'real CLI'}, ${options.coveredCases.join('/')}). Report: ${options.outputDirectory}`
      );
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
