import Database from 'better-sqlite3';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '../../helpers/agent-runtime-artifact-harness';
import { seedLegacyData } from '../../fixtures/agent-runtime-migration/seed.mjs';

for (const runtime of ['claude', 'codex', 'cursor']) {
  test(`E15: ${runtime} migration journal failure rolls back new profiles and repairs through UI`, async ({
    artifactApp: app,
    bundle,
    page,
  }) => {
    await seedLegacyData(app.directory);
    const pluginId = `com.zclaudia.${runtime}`;
    const journalKey = `builtin_plugin_migration:${pluginId}`;
    const manifestPath = path.join(bundle, 'builtin-plugins', runtime, 'plugin.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.contributes.agentProfiles.push({
      id: 'migration-canary',
      name: 'Migration canary',
      runtimeType: runtime,
    });
    await writeFile(manifestPath, JSON.stringify(manifest));
    function database<T>(operation: (db: Database.Database) => T): T {
      const db = new Database(path.join(app.directory, 'data/data.db'));
      try {
        return operation(db);
      } finally {
        db.close();
      }
    }
    database(db =>
      db.exec(`CREATE TRIGGER fail_migration_journal BEFORE INSERT ON app_config
      WHEN NEW.key = '${journalKey}'
      BEGIN SELECT RAISE(ABORT, 'E2E migration journal failure'); END;`)
    );
    await app.start();
    expect(
      (await app.api('/api/plugins')).find((plugin: any) => plugin.id === pluginId)
    ).toMatchObject({
      source: 'builtin',
      status: 'error',
      error: expect.stringContaining('E2E migration journal failure'),
    });
    const originalProfiles = await app.api('/api/agent-profiles');
    expect(originalProfiles).toHaveLength(4);
    expect(
      originalProfiles.find((profile: any) => profile.id === `legacy-${runtime}`)
    ).toMatchObject({
      name: `My ${runtime}`,
      model: 'user-selected-model',
      systemPrompt: 'Retain my prompt',
      runtimeType: runtime,
    });
    expect(
      database(db => db.prepare('SELECT value FROM app_config WHERE key=?').get(journalKey))
    ).toBeUndefined();
    expect(
      database(db =>
        db
          .prepare('SELECT id FROM agent_profiles WHERE plugin_id=? AND plugin_profile_id=?')
          .get(pluginId, 'migration-canary')
      )
    ).toBeUndefined();
    expect(await app.api(`/api/projects/project-${runtime}`)).toMatchObject({
      defaultAgentProfileId: `legacy-${runtime}`,
    });
    expect(await app.api(`/api/sessions/session-${runtime}`)).toMatchObject({
      agentProfileId: `legacy-${runtime}`,
      sdkSessionId: `provider-${runtime}`,
    });

    await page.goto(app.url);
    await page.getByRole('button', { name: 'Extensions', exact: true }).click();
    await page.getByRole('button', { name: 'Built-in', exact: true }).click();
    const label = runtime[0].toUpperCase() + runtime.slice(1);
    await page.getByRole('button', { name: `Open ${label} Agent`, exact: true }).click();
    await expect(page.getByRole('dialog').getByText(/E2E migration journal failure/)).toBeVisible();
    database(db => db.exec('DROP TRIGGER fail_migration_journal'));
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Reload runtime', exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await app.api('/api/plugins')).find((plugin: any) => plugin.id === pluginId).status
      )
      .toBe('active');
    const repaired = await app.api('/api/agent-profiles');
    expect(repaired).toHaveLength(5);
    expect(
      repaired.filter(
        (profile: any) =>
          profile.pluginId === pluginId && profile.pluginProfileId === 'migration-canary'
      )
    ).toHaveLength(1);
    const journal = database(db =>
      db.prepare('SELECT value FROM app_config WHERE key=?').get(journalKey)
    ) as { value: string };
    expect(JSON.parse(journal.value)).toEqual({ source: 'builtin', version: manifest.version });
    await app.restart();
    expect(await app.api('/api/agent-profiles')).toEqual(repaired);
    const retainedFiles = JSON.parse(
      await readFile(path.join(app.directory, 'legacy-files-before.json'), 'utf8')
    );
    for (const [filename, contents] of Object.entries(retainedFiles)) {
      expect(await readFile(path.join(app.directory, filename), 'utf8')).toBe(contents);
    }
  });
}
