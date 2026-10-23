import { Router, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import path from 'node:path';
import { resolveDataDir } from '../../infra/storage/db.js';
import { BlobStore } from '../../infra/design/blob-store.js';
import {
  DesignError,
  DesignService,
  isDesignAssetKind,
} from '../../application/design/design-service.js';
import { BrandService } from '../../application/design/brand-service.js';
import { DepsService } from '../../application/design/deps-service.js';
import { ExportService } from '../../application/design/export-service.js';
import { SnapshotService } from '../../application/design/snapshot-service.js';
import { RestoreService } from '../../application/design/restore-service.js';
import { TemplateService } from '../../application/design/template-service.js';

function handleError(res: Response, error: unknown): void {
  if (error instanceof DesignError) {
    res
      .status(error.status)
      .json({
        success: false,
        error: { code: error.code, message: error.message, ...(error.details ?? {}) },
      });
  } else {
    res
      .status(500)
      .json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Design request failed' },
      });
  }
}

export function createDesignRoutes(db: Database.Database): Router {
  const router = Router();
  const service = new DesignService(db);
  const blobs = new BlobStore(path.join(resolveDataDir(), 'design-snapshots'));
  const snapshots = new SnapshotService(db, blobs);
  const restores = new RestoreService(db, blobs, snapshots);
  const deps = new DepsService(db);
  const exportService = new ExportService(db);
  const templates = new TemplateService(service);
  const brand = new BrandService(service);
  router.get('/files', async (req: Request, res: Response) => {
    try {
      res.json({ success: true, data: await service.list(req.query.sessionId) });
    } catch (error) {
      handleError(res, error);
    }
  });
  router.get('/templates', async (req: Request, res: Response) => {
    try {
      res.json({ success: true, data: templates.list() });
    } catch (error) {
      handleError(res, error);
    }
  });
  router.post('/templates/install', async (req: Request, res: Response) => {
    try {
      const { sessionId, templateId, overwrite } = req.body ?? {};
      res.json({
        success: true,
        data: await templates.install(sessionId, templateId, overwrite),
      });
    } catch (error) {
      handleError(res, error);
    }
  });
  router.get('/brand', async (req: Request, res: Response) => {
    try {
      res.json({ success: true, data: await brand.read(req.query.sessionId) });
    } catch (error) {
      handleError(res, error);
    }
  });
  router.put('/brand', async (req: Request, res: Response) => {
    try {
      const { sessionId, designMd, designMdRevision, tokensCss, tokensCssRevision } = req.body ?? {};
      res.json({
        success: true,
        data: await brand.write(sessionId, {
          designMd,
          designMdRevision,
          tokensCss,
          tokensCssRevision,
        }),
      });
    } catch (error) {
      handleError(res, error);
    }
  });
  router.get('/assets', async (req: Request, res: Response) => {
    try {
      const kinds = req.query.kinds;
      if (kinds !== undefined && !isDesignAssetKind(kinds))
        throw new DesignError(
          400,
          'VALIDATION_ERROR',
          "kinds must be one of 'image', 'font' or 'all'"
        );
      res.json({ success: true, data: await service.listAssets(req.query.sessionId, kinds) });
    } catch (error) {
      handleError(res, error);
    }
  });
  router.post('/assets/import', async (req: Request, res: Response) => {
    try {
      const { sessionId, fileName, dataBase64, targetDir } = req.body ?? {};
      res.json({
        success: true,
        data: await service.importAsset(sessionId, fileName, dataBase64, targetDir),
      });
    } catch (error) {
      handleError(res, error);
    }
  });
  router.get('/document', async (req: Request, res: Response) => {
    try {
      res.json({
        success: true,
        data: await service.readDocument(req.query.sessionId, req.query.path),
      });
    } catch (error) {
      handleError(res, error);
    }
  });
  router.put('/document', async (req: Request, res: Response) => {
    try {
      const { sessionId, path, source, expectedRevision, allowCreate } = req.body ?? {};
      res.json({
        success: true,
        data: await service.writeDocument(sessionId, path, source, expectedRevision, allowCreate),
      });
    } catch (error) {
      handleError(res, error);
    }
  });
  router.get('/deps', async (req: Request, res: Response) => {
    try {
      res.json({ success: true, data: await deps.stat(req.query.sessionId, req.query.path) });
    } catch (error) {
      handleError(res, error);
    }
  });
  router.post('/export', async (req: Request, res: Response) => {
    try {
      const result = await exportService.exportZip(req.body ?? {});
      res.set('Content-Type', 'application/zip');
      res.set('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.set('Content-Length', String(result.buffer.length));
      res.send(result.buffer);
    } catch (error) {
      handleError(res, error);
    }
  });
  router.get('/asset', async (req: Request, res: Response) => {
    try {
      res.json({
        success: true,
        data: await service.readAsset(req.query.sessionId, req.query.path),
      });
    } catch (error) {
      handleError(res, error);
    }
  });
  router.get('/snapshots', async (req: Request, res: Response) => {
    try {
      res.json({
        success: true,
        data: await snapshots.list(req.query.sessionId, req.query.path),
      });
    } catch (error) {
      handleError(res, error);
    }
  });
  router.post('/snapshots', async (req: Request, res: Response) => {
    try {
      const { sessionId, path, label, source } = req.body ?? {};
      // Client-initiated captures are either explicit (manual) or a panel save
      // (save); pre-restore/restore are internal to RestoreService only.
      const kind = source === 'save' ? 'save' : 'manual';
      res.json({
        success: true,
        data: await snapshots.capture(sessionId, path, label, kind),
      });
    } catch (error) {
      handleError(res, error);
    }
  });
  router.get('/snapshots/:id', async (req: Request, res: Response) => {
    try {
      res.json({
        success: true,
        data: await snapshots.detail(req.query.sessionId, req.params.id),
      });
    } catch (error) {
      handleError(res, error);
    }
  });
  router.get('/snapshots/:id/file', async (req: Request, res: Response) => {
    try {
      res.json({
        success: true,
        data: await snapshots.readFile(req.query.sessionId, req.params.id, req.query.path),
      });
    } catch (error) {
      handleError(res, error);
    }
  });
  router.post('/snapshots/:id/restore', async (req: Request, res: Response) => {
    try {
      const { sessionId, expectedRevisions, confirmIncomplete } = req.body ?? {};
      res.json({
        success: true,
        data: await restores.restore(sessionId, req.params.id, expectedRevisions, confirmIncomplete),
      });
    } catch (error) {
      handleError(res, error);
    }
  });
  return router;
}
