import Database from 'better-sqlite3';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '../../helpers/agent-runtime-artifact-harness';
import { seedLegacyData } from '../../fixtures/agent-runtime-migration/seed.mjs';

for (const runtime of ['claude', 'codex', 'cursor']) {
  test(`E15: ${runtime} recovers after process termination inside the migration transaction`, async ({
    artifactApp: app,
    bundle,
  }, testInfo) => {
    await seedLegacyData(app.directory);
    const pluginId = `com.zclaudia.${runtime}`;
    const contributionId = 'migration-kill-canary';
    const manifestPath = path.join(bundle, 'builtin-plugins', runtime, 'plugin.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.contributes.agentProfiles.push({
      id: contributionId,
      name: 'Interrupted migration canary',
      runtimeType: runtime,
    });
    await writeFile(manifestPath, JSON.stringify(manifest));
    const entry = path.join(bundle, 'builtin-plugins', runtime, manifest.main);
    const original = await readFile(entry, 'utf8');
    // Test-only fault in a private artifact copy: run the real SQLite INSERT,
    // record that it is visible within the open transaction, then kill this
    // owned backend process before the host can write its journal and commit.
    const fault = `
      import { createRequire as e2eCreateRequire } from 'node:module';
      import { writeFileSync as e2eWriteFileSync } from 'node:fs';
      const E2eDatabase = e2eCreateRequire(${JSON.stringify(app.serverEntry)})('better-sqlite3');
      const e2ePrepare = E2eDatabase.prototype.prepare;
      E2eDatabase.prototype.prepare = function(sql) {
        const db = this;
        const statement = e2ePrepare.call(db, sql);
        if (/INSERT INTO agent_profiles/i.test(sql)) {
          const originalRun = statement.run;
          statement.run = function(...params) {
            const result = originalRun.apply(this, params);
            if (params.includes(${JSON.stringify(pluginId)}) && params.includes(${JSON.stringify(contributionId)})) {
              const row = e2ePrepare.call(db, 'SELECT COUNT(*) AS n FROM agent_profiles WHERE plugin_id=? AND plugin_profile_id=?').get(${JSON.stringify(pluginId)}, ${JSON.stringify(contributionId)});
              e2eWriteFileSync(process.env.E2E_RUNTIME_AUDIT + '.migration-killed.json', JSON.stringify({ rowsBeforeKill: row.n, transactionOpen: db.inTransaction, pid: process.pid }));
              process.kill(process.pid, 'SIGKILL');
            }
            return result;
          };
        }
        return statement;
      };
    `;
    await writeFile(entry, fault + original);
    await expect(app.start()).rejects.toThrow('Server exited during startup');
    const killed = JSON.parse(
      await readFile(path.join(app.directory, 'cli-audit.jsonl.migration-killed.json'), 'utf8')
    );
    expect(killed).toMatchObject({ rowsBeforeKill: 1, transactionOpen: true });
    expect(killed.pid).not.toBe(process.pid);
    const db = new Database(path.join(app.directory, 'data/data.db'));
    try {
      const afterCrash = {
        canary:
          db
            .prepare('SELECT id FROM agent_profiles WHERE plugin_id=? AND plugin_profile_id=?')
            .get(pluginId, contributionId) ?? null,
        journal:
          db
            .prepare('SELECT value FROM app_config WHERE key=?')
            .get(`builtin_plugin_migration:${pluginId}`) ?? null,
        profiles: db.prepare('SELECT COUNT(*) AS n FROM agent_profiles').get(),
        integrity: db.prepare('PRAGMA integrity_check').get(),
      };
      const evidencePath = testInfo.outputPath('migration-interruption.json');
      await writeFile(
        evidencePath,
        JSON.stringify({ runtime, beforeKill: killed, afterCrash }, null, 2)
      );
      await testInfo.attach('migration-interruption', {
        path: evidencePath,
        contentType: 'application/json',
      });
      expect(afterCrash.canary).toBeNull();
      expect(afterCrash.journal).toBeNull();
      expect(afterCrash.profiles).toEqual({ n: 4 });
      expect(afterCrash.integrity).toEqual({ integrity_check: 'ok' });
    } finally {
      db.close();
    }
    await app.stop();
    await writeFile(entry, original);
    await app.start();
    const profiles = await app.api('/api/agent-profiles');
    expect(profiles).toHaveLength(5);
    expect(
      profiles.filter(
        (profile: any) =>
          profile.pluginId === pluginId && profile.pluginProfileId === contributionId
      )
    ).toHaveLength(1);
    expect(profiles.find((profile: any) => profile.id === `legacy-${runtime}`)).toMatchObject({
      name: `My ${runtime}`,
      runtimeType: runtime,
      model: 'user-selected-model',
      systemPrompt: 'Retain my prompt',
    });
    expect(
      (await app.api('/api/plugins')).find((plugin: any) => plugin.id === pluginId)
    ).toMatchObject({ source: 'builtin', status: 'active' });
    expect(await app.api(`/api/projects/project-${runtime}`)).toMatchObject({
      defaultAgentProfileId: `legacy-${runtime}`,
    });
    expect(await app.api(`/api/sessions/session-${runtime}`)).toMatchObject({
      agentProfileId: `legacy-${runtime}`,
      sdkSessionId: `provider-${runtime}`,
    });
    await app.restart();
    expect(await app.api('/api/agent-profiles')).toEqual(profiles);
    const retainedFiles = JSON.parse(
      await readFile(path.join(app.directory, 'legacy-files-before.json'), 'utf8')
    );
    for (const [filename, contents] of Object.entries(retainedFiles))
      expect(await readFile(path.join(app.directory, filename), 'utf8')).toBe(contents);
  });
}
