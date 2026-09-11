import Database from 'better-sqlite3';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applyMigrations } from '../../../server/dist/infra/storage/migrations/index.js';

// Credential-free synthetic data using the schema already present at 504b9874.
export async function seedLegacyData(directory) {
  const data = path.join(directory, 'data');
  await mkdir(data, { recursive: true });
  const db = new Database(path.join(data, 'data.db'));
  try {
    applyMigrations(db);
    const development = path.join(directory, 'legacy-development');
    await mkdir(development, { recursive: true });
    db.prepare('INSERT INTO app_config (key,value) VALUES (?,?)').run(
      'plugin_extra_dirs',
      JSON.stringify([development])
    );
    db.prepare(
      'INSERT INTO llm_profiles (id,name,is_default,created_at,updated_at) VALUES (?,?,?,?,?)'
    ).run('legacy-llm', 'Retained empty provider', 1, 1000, 1000);
    for (const runtime of ['claude', 'codex', 'cursor']) {
      const id = `legacy-${runtime}`;
      db.prepare(
        `INSERT INTO agent_profiles
        (id,name,llm_profile_id,model,system_prompt,runtime_type,plugin_id,plugin_profile_id,source,is_default,cli_path,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        id,
        `My ${runtime}`,
        'legacy-llm',
        'user-selected-model',
        'Retain my prompt',
        runtime,
        `com.zclaudia.${runtime}`,
        `${runtime}-default`,
        'plugin',
        runtime === 'codex' ? 1 : 0,
        `/legacy/cli/${runtime}`,
        1000,
        1000
      );
      const cwd = path.join(directory, 'workspace', runtime);
      await mkdir(cwd, { recursive: true });
      db.prepare(
        'INSERT INTO projects (id,name,root_path,default_agent_profile_id,created_at,updated_at) VALUES (?,?,?,?,?,?)'
      ).run(`project-${runtime}`, `Legacy ${runtime} project`, cwd, id, 1000, 1000);
      db.prepare(
        'INSERT INTO sessions (id,project_id,name,agent_profile_id,sdk_session_id,working_directory,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)'
      ).run(
        `session-${runtime}`,
        `project-${runtime}`,
        `Legacy ${runtime} session`,
        id,
        `provider-${runtime}`,
        cwd,
        1000,
        1000
      );
      const external = path.join(development, runtime);
      await mkdir(external, { recursive: true });
      await writeFile(
        path.join(external, 'plugin.json'),
        JSON.stringify({
          id: `com.zclaudia.${runtime}`,
          name: `External ${runtime}`,
          description: 'Retained external fixture',
          version: '9.0.0',
          main: 'main.mjs',
          contributes: { agentRuntimes: [{ type: runtime }] },
        })
      );
      await writeFile(
        path.join(external, 'main.mjs'),
        "throw new Error('Shadowed external code executed');\n"
      );
      // Mirror the old package service's active copy + version store layout.
      // These are synthetic install records, not an old installer execution.
      const pluginId = `com.zclaudia.${runtime}`;
      const store = path.join(data, 'plugin-store', pluginId);
      const installedAt = '2026-09-01T00:00:00.000Z';
      for (const version of ['8.0.0', '9.0.0']) {
        const versionDir = path.join(store, version);
        await cp(external, versionDir, { recursive: true });
        await writeFile(
          path.join(versionDir, 'plugin.json'),
          JSON.stringify({
            id: pluginId,
            name: `Installed ${runtime}`,
            description: 'Retained managed fixture',
            version,
            main: 'main.mjs',
            activationEvents: ['onStartup'],
            contributes: { agentRuntimes: [{ type: runtime }] },
          })
        );
      }
      await cp(path.join(store, '9.0.0'), path.join(data, 'plugins', pluginId), {
        recursive: true,
      });
      await writeFile(
        path.join(store, 'install-state.json'),
        JSON.stringify({
          schemaVersion: 1,
          pluginId,
          activeVersion: '9.0.0',
          updatedAt: installedAt,
          versions: ['8.0.0', '9.0.0'].map(version => ({
            version,
            installedAt,
            sha256: '0'.repeat(64),
            size: 1024,
            originalFileName: `${runtime}-${version}.zplugin`,
          })),
        })
      );
      const refs = path.join(data, 'runtime-refs', `com.zclaudia.${runtime}`);
      await mkdir(refs, { recursive: true });
      await writeFile(
        path.join(refs, '9.0.0.json'),
        JSON.stringify({
          schemaVersion: 1,
          pluginId: `com.zclaudia.${runtime}`,
          pluginVersion: '9.0.0',
          runtime,
          platform: `${process.platform}-${process.arch}`,
          versions: ['1.2.3'],
          selectedVersion: '1.2.3',
          selectionHistory: [],
          updatedAt: '2026-09-01T00:00:00.000Z',
        })
      );
    }
    db.prepare(
      `INSERT INTO agent_profiles (id,name,llm_profile_id,model,system_prompt,runtime_type,source,created_at,updated_at)
      VALUES ('custom-codex','Custom Codex','legacy-llm','custom-model','custom prompt','codex','user',1000,1000)`
    ).run();
    const files = {};
    async function recordTree(root) {
      for (const entry of await readdir(root, { withFileTypes: true })) {
        const filename = path.join(root, entry.name);
        if (entry.isDirectory()) await recordTree(filename);
        else files[path.relative(directory, filename)] = await readFile(filename, 'utf8');
      }
    }
    for (const root of [
      development,
      ...['plugins', 'plugin-store', 'runtime-refs'].map(name => path.join(data, name)),
    ]) {
      await recordTree(root);
    }
    await writeFile(
      path.join(directory, 'legacy-files-before.json'),
      JSON.stringify(files, null, 2)
    );
  } finally {
    db.close();
  }
}
