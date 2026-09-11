// Vendor commands checked against these official references on 2026-09-11.
// Use the resolved backend executable, including managed installations that
// are absent from PATH. Never run a login command or move credentials here.
export const LOGIN_HELP: Record<string, { args: string[]; docs: string }> = {
  'com.zclaudia.claude': {
    args: ['auth', 'login'],
    docs: 'https://code.claude.com/docs/en/cli-usage',
  },
  'com.zclaudia.codex': {
    args: ['login'],
    docs: 'https://learn.chatgpt.com/docs/auth',
  },
  'com.zclaudia.cursor': {
    args: ['login'],
    docs: 'https://cursor.com/docs/cli/reference/authentication',
  },
};

export function runtimeLoginCommand(
  pluginId: string,
  executablePath: string | undefined,
  shell: 'posix' | 'powershell'
): string | undefined {
  const help = LOGIN_HELP[pluginId];
  if (
    !help ||
    !executablePath ||
    Array.from(executablePath).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    return undefined;
  const quote = (value: string) =>
    shell === 'powershell'
      ? `'${value.replaceAll("'", "''")}'`
      : `'${value.replaceAll("'", "'\\''")}'`;
  return `${shell === 'powershell' ? '& ' : ''}${quote(executablePath)} ${help.args.join(' ')}`;
}
