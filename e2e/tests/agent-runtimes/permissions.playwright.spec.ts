import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  test,
  expect,
  openCodingSession,
  sendCodingMessage,
} from '../../helpers/agent-runtime-harness';

for (const runtime of ['claude', 'codex']) {
  for (const decision of ['allow', 'deny']) {
    test(`E06: ${runtime} ${decision} approval controls the actual CLI side effect`, async ({
      app,
      page,
    }) => {
      const { project, session, cwd } = await app.configureCodingProject(runtime);
      await app.api(`/api/projects/${project.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          agentPermissionOverride: { escalateAlways: ['Bash'], aiReview: { enabled: false } },
        }),
      });
      await openCodingSession(page, app, project, session);
      await sendCodingMessage(page, 'E2E_PERMISSION');
      const button = page.getByRole('button', {
        name: decision === 'allow' ? 'Allow' : 'Deny',
        exact: true,
      });
      await expect(button).toBeVisible();
      const sideEffect = path.join(cwd, 'approval-side-effect.txt');
      await expect(readFile(sideEffect)).rejects.toMatchObject({ code: 'ENOENT' });
      await button.click();
      await expect(
        page.getByText(decision === 'allow' ? 'E2E_PERMISSION_ALLOWED' : 'E2E_PERMISSION_DENIED', {
          exact: true,
        })
      ).toBeVisible();
      expect((await app.audit()).find(event => event.approval)).toMatchObject({
        runtime,
        approval: decision,
      });
      if (decision === 'allow') expect(await readFile(sideEffect, 'utf8')).toBe('approved');
      else await expect(readFile(sideEffect)).rejects.toMatchObject({ code: 'ENOENT' });
    });
  }
}
