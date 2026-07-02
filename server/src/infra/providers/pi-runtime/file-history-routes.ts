import { Router, type Request, type Response } from 'express';
import { getFileBackup, restoreFileBackup } from './file-history.js';

export function createFileHistoryRoutes(): Router {
  const router = Router();

  router.get('/file-history/backups/:id', async (req: Request, res: Response) => {
    const backup = await getFileBackup(req.params.id);
    if (!backup) {
      res
        .status(404)
        .json({ success: false, error: { code: 'NOT_FOUND', message: 'Backup not found' } });
      return;
    }
    res.json({ success: true, data: backup });
  });

  router.post('/file-history/backups/:id/restore', async (req: Request, res: Response) => {
    try {
      const restored = await restoreFileBackup(req.params.id);
      res.json({ success: true, data: restored });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(message === 'backup_not_found' ? 404 : 400).json({
        success: false,
        error: { code: message === 'backup_not_found' ? 'NOT_FOUND' : 'RESTORE_FAILED', message },
      });
    }
  });

  return router;
}
