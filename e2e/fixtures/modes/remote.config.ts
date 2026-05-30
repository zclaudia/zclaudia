import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ModeConfig } from '../../helpers/modes';

const AUTH_PATH = path.join(os.homedir(), '.zclaudia', 'auth.json');
let realApiKey = 'test-api-key';
try {
  const config = JSON.parse(fs.readFileSync(AUTH_PATH, 'utf-8'));
  realApiKey = config.apiKey;
} catch {
  // Local auth config is optional in fixtures.
}

export const remoteMode: ModeConfig = {
  id: 'remote',
  name: 'Remote IP',
  enabled: true,
  serverAddress: process.env.REMOTE_SERVER_ADDRESS || '127.0.0.1:3100',
  requiresAuth: true,
  apiKey: process.env.REMOTE_API_KEY || realApiKey,
};
