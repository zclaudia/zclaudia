/**
 * Phase B1 network-denial detection (spec: detection approach A).
 *
 * The sandbox library surfaces a blocked network call only as an opaque
 * connection failure in stderr (no host, indistinguishable from a real
 * network error). We therefore (1) match a network-failure signature in the
 * output, then (2) extract candidate hosts from the COMMAND and (3) keep only
 * those not already on the allow-list. Command parsing happens only after a
 * failure and only to name the host — never to make a security decision.
 */

/** Tool name for the network escalation prompt; registered in the provider's escalateAlwaysTools. */
export const SANDBOX_NETWORK_ESCALATION_TOOL = 'SandboxNetworkAccess';

/** Cap on detect→escalate→re-run iterations per command (one command may hit several hosts). */
export const MAX_ESCALATION_ITERATIONS = 5;

const NETWORK_FAILURE_PATTERNS: RegExp[] = [
  /curl:\s*\(\d+\)/i,
  /could(?:n'?t| not) resolve host/i,
  /connection (?:timed out|refused|reset)/i,
  /\b(?:ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNRESET|ENETUNREACH)\b/,
  /wget:.*(?:unable to resolve|failed|timed out)/i,
];

function extractHosts(command: string): string[] {
  const hosts: string[] = [];
  // Capture only authority-legal characters after the scheme (userinfo/host/port).
  // This stops at the first path/query/fragment/shell delimiter (/ ? # ; , space quotes).
  const urlRe = /\bhttps?:\/\/([A-Za-z0-9._~%:@-]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = urlRe.exec(command)) !== null) {
    let host = m[1];
    const at = host.lastIndexOf('@');
    if (at >= 0) host = host.slice(at + 1); // strip user:pw@
    host = host.replace(/:\d+$/, '');        // strip :port
    host = host.replace(/\.+$/, '');         // strip trailing dot(s)
    if (host) hosts.push(host.toLowerCase());
  }
  return hosts;
}

function isDomainAllowed(host: string, allowed: ReadonlySet<string>): boolean {
  for (const d of allowed) {
    const dl = d.toLowerCase();
    if (host === dl || host.endsWith('.' + dl)) return true;
  }
  return false;
}

/**
 * Returns the set of un-allowed hosts a failed command tried to reach, or null
 * when the failure is not a network denial (or all hosts are already allowed).
 */
export function detectSandboxDenial(
  command: string,
  output: string,
  allowedDomains: ReadonlySet<string>,
): { hosts: string[] } | null {
  if (!NETWORK_FAILURE_PATTERNS.some((re) => re.test(output))) return null;
  const unallowed = [...new Set(extractHosts(command))].filter((h) => !isDomainAllowed(h, allowedDomains));
  if (unallowed.length === 0) return null;
  return { hosts: unallowed };
}
