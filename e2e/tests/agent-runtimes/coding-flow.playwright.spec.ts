import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '../../helpers/agent-runtime-harness';

for (const runtime of ['cursor', 'codex', 'claude']) {
  test(`E02/E03: ${runtime} runs the actual adapter through UI and modifies the project`, async ({
    app,
    page,
  }) => {
    const marker = `E2E_${runtime.toUpperCase()}_CODING_COMPLETE`;
    const { project, session, cwd } = await app.configureCodingProject(runtime, page);
    await page.goto(app.url);
    await page.getByText(project.name, { exact: true }).click();
    await page
      .getByTestId('session-item')
      .getByRole('button', { name: session.name, exact: true })
      .click();
    const input = page.getByTestId('message-input');
    await expect(input).toBeEditable();
    await input.fill('Fix addition in add.mjs and run its test.');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.getByText(marker, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
    expect(await readFile(path.join(cwd, 'add.mjs'), 'utf8')).toContain('a + b');
    const audit = (await readFile(path.join(app.directory, 'cli-audit.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    expect(audit[0]).toMatchObject({ runtime, cwd });
    expect(audit.every(event => event.model === undefined)).toBe(true);
    expect(audit.some(event => event.testExitCode === 0)).toBe(true);
    await page.reload();
    await page.getByText(project.name, { exact: true }).click();
    await page
      .getByTestId('session-item')
      .getByRole('button', { name: session.name, exact: true })
      .click();
    await expect(page.getByText(marker, { exact: true })).toBeVisible();
  });
}
