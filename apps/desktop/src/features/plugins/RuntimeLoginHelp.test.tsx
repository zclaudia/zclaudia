import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RuntimeLoginHelp } from './RuntimeLoginHelp';
import { runtimeLoginCommand } from './runtime-login';
import { isTauri } from '../../utils/platform';
import { open } from '@tauri-apps/plugin-shell';

vi.mock('../../utils/platform', () => ({ isTauri: vi.fn(() => false) }));
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe('runtime login help', () => {
  it('opens official instructions in the desktop browser and reports opener failures', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(open).mockRejectedValueOnce(new Error('Browser unavailable'));
    render(
      <RuntimeLoginHelp
        pluginId="com.zclaudia.codex"
        executablePath="/managed/codex"
        authState="auth-required"
      />
    );
    fireEvent.click(screen.getByRole('link', { name: 'Official login instructions' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://learn.chatgpt.com/docs/auth'));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('https://learn.chatgpt.com/docs/auth')
    );
    vi.mocked(open).mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole('link', { name: 'Official login instructions' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
  it('runs only the literal POSIX executable with the vendor login arguments', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'runtime-login-'));
    try {
      const executable = path.join(directory, "CLI 中文 ' $(echo WRONG) `echo WRONG`");
      writeFileSync(executable, '#!/bin/sh\nprintf "%s\\n" "$@"\n');
      chmodSync(executable, 0o755);
      for (const runtime of ['claude', 'codex', 'cursor']) {
        const command = runtimeLoginCommand(`com.zclaudia.${runtime}`, executable, 'posix')!;
        expect(execFileSync('/bin/sh', ['-c', command], { encoding: 'utf8' })).toBe(
          runtime === 'claude' ? 'auth\nlogin\n' : 'login\n'
        );
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('offers explicit PowerShell syntax without using the client OS', () => {
    render(
      <RuntimeLoginHelp
        pluginId="com.zclaudia.codex"
        executablePath={"C:\\CLI user's\\codex.exe"}
        authState="auth-required"
      />
    );
    expect(screen.getByLabelText('Backend shell')).toHaveValue('powershell');
    expect(screen.getByLabelText('Login command')).toHaveTextContent(
      "& 'C:\\CLI user''s\\codex.exe' login"
    );
    fireEvent.change(screen.getByLabelText('Backend shell'), { target: { value: 'posix' } });
    expect(screen.getByLabelText('Login command').textContent).toBe(
      "'C:\\CLI user'\\''s\\codex.exe' login"
    );
  });

  it('does not invent an executable or claim that unknown authentication is verified', () => {
    render(<RuntimeLoginHelp pluginId="com.zclaudia.cursor" authState="unknown" />);
    expect(screen.queryByLabelText('Login command')).not.toBeInTheDocument();
    expect(screen.getByText(/Authentication has not been checked/)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Official login instructions', hidden: true })
    ).toHaveAttribute('href', 'https://cursor.com/docs/cli/reference/authentication');
    expect(runtimeLoginCommand('com.zclaudia.cursor', '/bad\npath', 'posix')).toBeUndefined();
    expect(runtimeLoginCommand('other.plugin', '/bin/cli', 'posix')).toBeUndefined();
  });

  it('keeps the command selectable when browser clipboard access is unavailable', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) },
    });
    render(
      <RuntimeLoginHelp
        pluginId="com.zclaudia.claude"
        executablePath="/managed/claude"
        authState="auth-required"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy login command' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Select and copy'));
    expect(screen.getByLabelText('Login command')).toHaveTextContent(
      "'/managed/claude' auth login"
    );
    expect(screen.queryByRole('button', { name: 'Copied login command' })).not.toBeInTheDocument();
  });
});
