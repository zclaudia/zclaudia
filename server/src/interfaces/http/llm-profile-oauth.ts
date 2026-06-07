import { Router, type Request, type Response } from 'express';
import type { LlmProfileRepository } from '../../domains/llm-profiles/repository.js';
import type { CodexOAuthSessionManager } from '../../domains/llm-profiles/codex-oauth-session.js';
import { CodexOAuthError, codexOAuthErrorToHttpStatus } from '../../domains/llm-profiles/codex-oauth-errors.js';
import { fetchCodexModels } from '../../domains/llm-profiles/codex-models.js';

function handleCodexError(res: Response, err: unknown): void {
  if (err instanceof CodexOAuthError) {
    res.status(codexOAuthErrorToHttpStatus(err.code)).json({ error: { code: err.code, message: err.message } });
    return;
  }
  console.error('[llm-profile-oauth] unexpected error', err);
  res.status(500).json({ error: { code: 'INTERNAL', message: err instanceof Error ? err.message : 'unknown' } });
}

export function createLlmProfileOauthRouter(
  repo: LlmProfileRepository,
  sessions: CodexOAuthSessionManager,
): Router {
  const router = Router({ mergeParams: true });

  router.post('/:id/oauth/start', async (req: Request, res: Response) => {
    const profileId = req.params.id;
    const profile = repo.findById(profileId);
    if (!profile) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'profile not found' } }); return; }
    if (profile.providerType !== 'openai-codex') {
      res.status(400).json({ error: { code: 'INVALID_PROVIDER', message: 'profile is not openai-codex' } });
      return;
    }

    const method = req.body?.method === 'device_code' ? 'device_code' : 'browser';
    try {
      const result = method === 'browser'
        ? await sessions.startBrowserFlow(profileId)
        : await sessions.startDeviceCodeFlow(profileId);
      res.json(result);
    } catch (err) {
      handleCodexError(res, err);
    }
  });

  router.get('/:id/oauth/status/:sessionId', (req: Request, res: Response) => {
    const status = sessions.getStatus(req.params.sessionId);
    if (!status) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'session not found or expired' } });
      return;
    }
    if (status.state === 'success') {
      res.json({ state: 'success', accountId: status.accountId });
      return;
    }
    if (status.state === 'error') {
      res.json({ state: 'error', code: status.code, message: status.message });
      return;
    }
    res.json(status);
  });

  router.post('/:id/oauth/cancel/:sessionId', (req: Request, res: Response) => {
    sessions.cancel(req.params.sessionId);
    res.json({ ok: true });
  });

  router.post('/:id/oauth/signout', (req: Request, res: Response) => {
    const profileId = req.params.id;
    const profile = repo.findById(profileId);
    if (!profile) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'profile not found' } });
      return;
    }
    if (profile.providerType !== 'openai-codex') {
      res.status(400).json({ error: { code: 'INVALID_PROVIDER', message: 'profile is not openai-codex' } });
      return;
    }
    repo.update(profileId, { oauthCredentials: null as unknown as undefined });
    res.json({ ok: true });
  });

  router.get('/:id/codex-models', async (req: Request, res: Response) => {
    const profile = repo.findById(req.params.id);
    if (!profile) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'profile not found' } }); return; }
    if (!profile.oauthCredentials) {
      res.status(401).json({ error: { code: 'NOT_AUTHENTICATED', message: 'profile not authenticated' } });
      return;
    }
    const refresh = req.query.refresh === 'true';
    try {
      const result = await fetchCodexModels(
        profile.id,
        profile.oauthCredentials.access,
        profile.oauthCredentials.accountId,
        { refresh },
      );
      res.json(result);
    } catch (err) {
      handleCodexError(res, err);
    }
  });

  return router;
}
