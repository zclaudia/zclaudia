// Stable per-device identity for the gateway client. Extracted from GatewayClient so the
// device.json read/create is a cohesive, independently testable unit (QA-0027).
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { newId } from '../../utils/uuid.js';

const CONFIG_DIR = process.env.ZCLAUDIA_DATA_DIR
  ? path.resolve(process.env.ZCLAUDIA_DATA_DIR)
  : path.join(os.homedir(), '.zclaudia');
const DEVICE_CONFIG_PATH = path.join(CONFIG_DIR, 'device.json');

interface DeviceConfig {
  deviceId: string;
  createdAt: number;
}

/**
 * Returns the persisted device id, creating and storing a new one on first run or when the
 * existing device.json is unreadable/corrupt.
 */
export function getOrCreateDeviceId(): string {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  if (fs.existsSync(DEVICE_CONFIG_PATH)) {
    try {
      const config: DeviceConfig = JSON.parse(fs.readFileSync(DEVICE_CONFIG_PATH, 'utf-8'));
      return config.deviceId;
    } catch {
      /* fall through */
    }
  }
  const deviceId = newId();
  fs.writeFileSync(
    DEVICE_CONFIG_PATH,
    JSON.stringify({ deviceId, createdAt: Date.now() }, null, 2)
  );
  console.log(`[Gateway] Generated new device ID: ${deviceId}`);
  return deviceId;
}
