import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { ensureCodexProjectTrusted, mapModeToConfigArgs } from '../config.js';

it.each(['', '[sandbox_workspace_write]\nnetwork_access = false\n'])(
  'trusts the project without changing user sandbox defaults: %j',
  existing => {
    const root = mkdtempSync(join(tmpdir(), 'codex-trust-'));
    vi.stubEnv('ZCLAUDIA_AGENT_CONFIG_ROOT', root);
    try {
      const directory = join(root, 'codex');
      mkdirSync(directory);
      const configPath = join(directory, 'config.toml');
      writeFileSync(configPath, existing);
      ensureCodexProjectTrusted(root);
      const config = readFileSync(configPath, 'utf8');
      expect(config).toContain('trust_level = "trusted"');
      if (existing) expect(config).toContain(existing);
      else expect(config).not.toContain('[sandbox_workspace_write]');
      expect(config).not.toContain('network_access = true');
      // The current app-server still gets the file-delivery network grant.
      expect(mapModeToConfigArgs('default')).toContain(
        'sandbox_workspace_write.network_access=true'
      );
    } finally {
      vi.unstubAllEnvs();
      rmSync(root, { recursive: true, force: true });
    }
  }
);
