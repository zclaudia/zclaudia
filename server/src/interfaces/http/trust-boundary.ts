const DEFAULT_ALLOWED_ORIGIN_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '[::1]',
  'tauri.localhost',
]);

const DEFAULT_ALLOWED_ORIGIN_PROTOCOLS = new Set(['http:', 'https:', 'tauri:', 'app:']);

function splitConfiguredOrigins(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
}

export function defaultServerHost(env: NodeJS.ProcessEnv = process.env): string {
  if (env.SERVER_HOST) return env.SERVER_HOST;
  return env.ZCLAUDIA_ALLOW_LAN === '1' ? '0.0.0.0' : '127.0.0.1';
}

export function isRequestOriginAllowed(
  origin: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (!origin) {
    return true;
  }

  const configured = splitConfiguredOrigins(env.ZCLAUDIA_ALLOWED_ORIGINS);
  if (configured.includes(origin)) {
    return true;
  }
  if (configured.includes('*') && env.ZCLAUDIA_TRUST_MODE === 'unsafe') {
    return true;
  }

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  return (
    DEFAULT_ALLOWED_ORIGIN_PROTOCOLS.has(parsed.protocol) &&
    DEFAULT_ALLOWED_ORIGIN_HOSTS.has(parsed.hostname)
  );
}

export function createCorsOriginGuard(env: NodeJS.ProcessEnv = process.env) {
  return (
    origin: string | undefined,
    callback: (error: Error | null, allow?: boolean) => void
  ): void => {
    if (isRequestOriginAllowed(origin, env)) {
      callback(null, true);
      return;
    }
    callback(new Error(`Origin not allowed: ${origin}`));
  };
}
