/**
 * Normalize a user-entered gateway base URL so URL construction downstream
 * (`${gw}/api/proxy/...`, `${gw}/api/notifications/...`, WSS upgrade, …) can
 * never produce a double slash.
 *
 * The gateway 404s on `//api/...`, and a pasted URL very commonly carries a
 * trailing slash (browsers address-bar copies do), so trim it here once
 * instead of at every consumer.
 */
export function normalizeGatewayUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  return trimmed;
}
