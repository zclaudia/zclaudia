import { useState } from 'react';
import { isTauri } from '../../utils/platform';

import { LOGIN_HELP, runtimeLoginCommand } from './runtime-login';

export function RuntimeLoginHelp({
  pluginId,
  executablePath,
  authState,
}: {
  pluginId: string;
  executablePath?: string;
  authState?: string;
}) {
  const [shell, setShell] = useState<'posix' | 'powershell'>(
    executablePath && /^(?:[a-z]:[\\/]|\\\\)/i.test(executablePath) ? 'powershell' : 'posix'
  );
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [linkError, setLinkError] = useState(false);
  const help = LOGIN_HELP[pluginId];
  if (!help) return null;
  const command = runtimeLoginCommand(pluginId, executablePath, shell);

  return (
    <details className="space-y-2 text-xs" open={authState === 'auth-required' ? true : undefined}>
      <summary className="cursor-pointer text-primary">Login help</summary>
      <p className="text-muted-foreground">
        Run the login command in a terminal on the connected backend, using the same operating
        system account and CLI configuration as ZClaudia. Then refresh status here.
      </p>
      {authState === 'unknown' && (
        <p className="text-muted-foreground">
          Authentication has not been checked. A detected CLI does not confirm that you are signed
          in.
        </p>
      )}
      {command ? (
        <>
          <label className="flex items-center gap-2">
            Backend shell
            <select
              value={shell}
              onChange={event => {
                setShell(event.target.value as 'posix' | 'powershell');
                setCopied(false);
                setCopyError(false);
              }}
              className="rounded border border-border bg-background px-2 py-1"
            >
              <option value="posix">Bash / Zsh / sh</option>
              <option value="powershell">PowerShell</option>
            </select>
          </label>
          <pre
            className="whitespace-pre-wrap break-all rounded bg-secondary p-2"
            aria-label="Login command"
          >
            {command}
          </pre>
          <button
            type="button"
            className="text-primary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(command);
                setCopied(true);
                setCopyError(false);
              } catch {
                setCopied(false);
                setCopyError(true);
              }
            }}
          >
            {copied ? 'Copied login command' : 'Copy login command'}
          </button>
          {copyError && <p role="alert">Copy is unavailable. Select and copy the command above.</p>}
        </>
      ) : (
        <p className="text-muted-foreground">
          Install the CLI or configure its executable path in an agent profile before logging in.
        </p>
      )}
      <a
        href={help.docs}
        target="_blank"
        rel="noopener noreferrer"
        className="block text-primary"
        onClick={async event => {
          if (!isTauri()) return;
          event.preventDefault();
          try {
            const { open } = await import('@tauri-apps/plugin-shell');
            await open(help.docs);
            setLinkError(false);
          } catch {
            setLinkError(true);
          }
        }}
      >
        Official login instructions
      </a>
      {linkError && (
        <p role="alert">Could not open the browser. Open this address manually: {help.docs}</p>
      )}
    </details>
  );
}
