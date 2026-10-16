import * as os from 'os';
import * as path from 'path';

/** Expand a leading `~/` to an absolute home path (silent non-match = no protection; we don't rely on the lib's ~ handling). */
export function expandHome(p: string): string {
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

/** Credential paths to deny-read (operator-overridable default; spec §4). Pre-expanded to absolute. */
export const SENSITIVE_DENY_READ: string[] = [
  '~/.ssh',
  '~/.gnupg',
  '~/.aws/credentials',
  '~/.config/gcloud',
  '~/.azure',
  '~/.docker/config.json',
  '~/.kube/config',
  '~/.config/gh/hosts.yml',
  '~/.npmrc',
  '~/.pypirc',
  '~/.cargo/credentials.toml',
  '~/.netrc',
  '~/.vault-token',
  '~/.terraformrc',
  '~/.bash_history',
  '~/.zsh_history',
  '~/.zhistory',
  '~/Library/Safari',
  '~/Library/Application Support/Google/Chrome',
  '~/Library/Application Support/Firefox/Profiles',
].map(expandHome);
