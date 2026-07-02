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

export const gatewayMode: ModeConfig = {
  id: 'gateway',
  name: 'Gateway Mode',
  enabled: true,
  serverAddress: 'localhost:3200',
  requiresAuth: true,
  gatewayUrl: 'ws://localhost:3200',
  gatewaySecret: process.env.GATEWAY_SECRET || 'test-secret-zclaudia-2026',
  backendId: undefined,
  apiKey: process.env.GATEWAY_API_KEY || realApiKey,

  // Optional proxy
  proxyUrl: process.env.SOCKS5_PROXY_URL,
  proxyAuth: process.env.SOCKS5_PROXY_USER
    ? {
        username: process.env.SOCKS5_PROXY_USER,
        password: process.env.SOCKS5_PROXY_PASS || '',
      }
    : undefined,
};
