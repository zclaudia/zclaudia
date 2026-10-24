import { Router, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import { createReadStream } from 'node:fs';
import os from 'node:os';
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
import { ShareService } from '../../application/design/share-service.js';
import { TemplateService } from '../../application/design/template-service.js';
import {
  MediaTaskService,
  createGeneratedAssetWriter,
  createImageTaskExecutor,
} from '../../application/design/media-task-service.js';
import { createOpenAiImagesProvider } from '../../application/design/media-image-provider.js';
import {
  createVideoRenderExecutor,
  defaultVideoRenderDeps,
} from '../../application/design/video-render-service.js';
import { LlmProfileRepository } from '../../domains/llm-profiles/repository.js';
import type {
  DesignMediaProviderRef,
  DesignMediaTaskParams,
  MediaImageProvider,
  MediaImageProviderInfo,
  MediaTaskExecution,
  MediaTaskExecutor,
  MediaTaskExecutors,
} from '../../application/design/media-types.js';

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

// ---------------------------------------------------------------------------
// P6 媒体路由（设计文档 §6）：五个端点 + 缺省真装配（测试注入假件绕开）。
// ---------------------------------------------------------------------------

/** 与 L30 createOpenAiImagesProvider().info 一致的静态清单（本批唯一 provider）。 */
const MEDIA_IMAGE_PROVIDER_INFO: MediaImageProviderInfo = {
  id: 'openai-images',
  label: 'OpenAI-compatible image service',
  capabilities: ['generate', 'edit'],
};

/** 媒体路由可注入依赖：缺省（未提供 mediaService）走真装配，测试注入假件。 */
export interface DesignMediaRoutesDeps {
  /** 注入则完全绕开真装配的 MediaTaskService（测试用）。 */
  mediaService?: MediaTaskService;
  /** providers 端点数据源（测试注入假 profile 清单）。 */
  listProfiles?: () => Array<{ id: string; name: string; providerType: string; apiKey?: string }>;
  /** 图片 provider 工厂（测试注入假 provider）。 */
  makeImageProvider?: (ref: DesignMediaProviderRef) => Promise<MediaImageProvider>;
}

/** 文件名时间戳：YYYYMMDD-HHmmss（UTC），与 L31 generatedImageFileName 同款。 */
function formatStamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  );
}

/** render-<entrySlug>-<YYYYMMDD-HHmmss>.mp4；slug 取入口基名去扩展小写折叠，空则 video。 */
function renderVideoFileName(params: DesignMediaTaskParams): string {
  const base = params.type === 'video-render' ? path.basename(params.entryPath) : '';
  const slug =
    base
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 24)
      .replace(/^-+|-+$/g, '') || 'video';
  return `render-${slug}-${formatStamp(new Date())}.mp4`;
}

/** 查询串数字整形：整数字符串 → number，其余原样交给服务层按非法值回退。 */
function numericQuery(value: unknown): unknown {
  if (typeof value === 'string' && value !== '' && Number.isInteger(Number(value))) {
    return Number(value);
  }
  return value;
}

/** 真装配的图片 provider 工厂：llm_profiles 凭据 → openai-images（§0.3）。 */
function defaultMakeImageProvider(
  profilesRepo: LlmProfileRepository
): (ref: DesignMediaProviderRef) => Promise<MediaImageProvider> {
  return async ref => {
    const profile = profilesRepo.findById(ref.profileId);
    if (!profile || profile.providerType !== 'openai') {
      throw new DesignError(400, 'MEDIA_VALIDATION', 'The specified service profile does not exist or does not support image generation');
    }
    if (!profile.apiKey) {
      throw new DesignError(400, 'MEDIA_VALIDATION', 'The selected service profile has no API key');
    }
    return createOpenAiImagesProvider({
      baseUrl: profile.baseUrl,
      apiKey: profile.apiKey,
      requestHeaders: profile.requestHeaders,
      model: ref.model,
    });
  };
}

/** 真装配的图片执行器：源图读取与产物导入绑 DesignService + 提交会话（§1.5）。 */
function buildImageExecutor(
  service: DesignService,
  makeProvider: (ref: DesignMediaProviderRef) => Promise<MediaImageProvider>
): MediaTaskExecutor {
  return createImageTaskExecutor({
    designService: service,
    makeProvider,
    readSourceImage: async (sessionId, sourcePath) => {
      const asset = await service.readAsset(sessionId, sourcePath);
      return { mime: asset.mimeType, bytes: Buffer.from(asset.data, 'base64') };
    },
    importGeneratedImage: (sessionId, fileName, bytes, targetDir) =>
      service.importAsset(sessionId, fileName, bytes.toString('base64'), targetDir),
  });
}

/**
 * 真装配的视频执行器（§4.4 步骤 7）：产物文件名依赖该任务的 entryPath，而
 * 执行器 deps 在构造期固定——按任务包装：现算 render-<entrySlug>-<ts>.mp4
 * 再建执行器，saveOutput 经 L31 createGeneratedAssetWriter 落 design/assets。
 */
function buildVideoExecutor(service: DesignService): MediaTaskExecutor {
  return (execution: MediaTaskExecution, ctx: Parameters<MediaTaskExecutor>[1]) =>
    createVideoRenderExecutor({
      ...defaultVideoRenderDeps(),
      saveOutput: (sessionId, bytes) =>
        createGeneratedAssetWriter(service, sessionId)(
          renderVideoFileName(execution.params),
          bytes,
          'video/mp4'
        ),
    })(execution, ctx);
}

/**
 * 局域网分享 URL 尽力而为枚举（P7 §0.7/§5）：仅当服务绑定非回环
 * （SERVER_HOST=0.0.0.0 或 ZCLAUDIA_ALLOW_LAN=1）时，枚举非 internal 的
 * IPv4 地址拼 `/s/<token>`（端口取 PORT ?? 3100）；未启用时为空数组。
 */
function lanShareUrls(token: string): string[] {
  if (process.env.SERVER_HOST !== '0.0.0.0' && process.env.ZCLAUDIA_ALLOW_LAN !== '1') {
    return [];
  }
  const port = process.env.PORT ?? '3100';
  const urls: string[] = [];
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const entry of interfaces ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        urls.push(`http://${entry.address}:${port}/s/${token}`);
      }
    }
  }
  return urls;
}

export function createDesignRoutes(db: Database.Database, mediaDeps?: DesignMediaRoutesDeps): Router {
  const router = Router();
  const service = new DesignService(db);
  const blobs = new BlobStore(path.join(resolveDataDir(), 'design-snapshots'));
  const snapshots = new SnapshotService(db, blobs);
  const restores = new RestoreService(db, blobs, snapshots);
  const deps = new DepsService(db);
  const exportService = new ExportService(db);
  const templates = new TemplateService(service);
  const brand = new BrandService(service);
  // P7 §5 分享装配：与既有服务同款一行式（快照引用 + 公开 token 访问）。
  const shares = new ShareService(db, service, blobs);

  // --- P6 媒体装配：mediaService 注入则完全绕开真装配（测试用）。 ---
  // MediaTaskService 惰性构造（首个媒体端点调用时才装配）：其构造期重启收尾
  // 需要 migration 051 的表，延迟装配让未迁移场景（既有测试/宿主）的非媒体
  // 端点完全不受影响；生产启动迁移后行为与构造期收尾一致。
  const profilesRepo = new LlmProfileRepository(db);
  const listProfiles: NonNullable<DesignMediaRoutesDeps['listProfiles']> =
    mediaDeps?.listProfiles ?? (() => profilesRepo.findAllOrdered());
  const makeImageProvider =
    mediaDeps?.makeImageProvider ?? defaultMakeImageProvider(profilesRepo);
  let mediaServiceInstance: MediaTaskService | null = mediaDeps?.mediaService ?? null;
  const mediaService = (): MediaTaskService => {
    mediaServiceInstance ??= new MediaTaskService(
      db,
      service,
      {
        'image-generate': buildImageExecutor(service, makeImageProvider),
        'image-edit': buildImageExecutor(service, makeImageProvider),
        'video-render': buildVideoExecutor(service),
      } satisfies MediaTaskExecutors,
      {
        // 提交期即限定 openai 型 profile（执行期的 makeImageProvider 校验保留为纵深防御）。
        resolveProfileName: id => {
          const profile = profilesRepo.findById(id);
          return profile && profile.providerType === 'openai' ? profile.name : null;
        },
      }
    );
    return mediaServiceInstance;
  };

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
          "kinds must be one of 'image', 'font', 'video' or 'all'"
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
  router.get('/media/providers', async (req: Request, res: Response) => {
    try {
      // 仅 openai 型 profile 可用于图片生成；hasCredential 布尔，绝不返回密钥。
      const profiles = listProfiles()
        .filter(profile => profile.providerType === 'openai')
        .map(profile => ({
          id: profile.id,
          name: profile.name,
          providerType: profile.providerType,
          hasCredential: Boolean(profile.apiKey),
        }));
      res.json({ success: true, data: { providers: [MEDIA_IMAGE_PROVIDER_INFO], profiles } });
    } catch (error) {
      handleError(res, error);
    }
  });
  router.post('/media-tasks', async (req: Request, res: Response) => {
    try {
      const { sessionId, ...input } = req.body ?? {};
      res.status(201).json({ success: true, data: await mediaService().create(sessionId, input) });
    } catch (error) {
      handleError(res, error);
    }
  });
  router.get('/media-tasks', async (req: Request, res: Response) => {
    try {
      res.json({
        success: true,
        data: { tasks: await mediaService().list(req.query.sessionId, numericQuery(req.query.limit)) },
      });
    } catch (error) {
      handleError(res, error);
    }
  });
  router.post('/media-tasks/:id/cancel', async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.body ?? {};
      res.json({ success: true, data: await mediaService().cancel(sessionId, req.params.id) });
    } catch (error) {
      handleError(res, error);
    }
  });
  router.get('/media-tasks/:id/result', async (req: Request, res: Response) => {
    try {
      const target = await mediaService().resultTarget(req.query.sessionId, req.params.id);
      res.set('Content-Type', target.mime);
      res.set('Content-Disposition', `attachment; filename="${target.fileName}"`);
      res.set('Content-Length', String(target.bytes));
      const stream = createReadStream(target.absolutePath);
      // 流错误：头未发出按信封回错；已发出（半途失败）只能截断响应。
      stream.on('error', (error: Error) => {
        if (res.headersSent) {
          res.end();
        } else {
          handleError(res, error);
        }
      });
      stream.pipe(res);
    } catch (error) {
      handleError(res, error);
    }
  });
  // --- P7 §5 分享所有者路由：sessionId 鉴权在服务层；shareUrl/lanUrls 路由层拼。 ---
  router.post('/shares', async (req: Request, res: Response) => {
    try {
      const { sessionId, ...input } = req.body ?? {};
      const share = await shares.create(sessionId, input);
      res.status(201).json({
        success: true,
        data: {
          share,
          shareUrl: `${req.protocol}://${req.get('host')}/s/${share.token}`,
          lanUrls: lanShareUrls(share.token),
        },
      });
    } catch (error) {
      handleError(res, error);
    }
  });
  router.get('/shares', async (req: Request, res: Response) => {
    try {
      res.json({
        success: true,
        data: { shares: await shares.list(req.query.sessionId, req.query.entryPath) },
      });
    } catch (error) {
      handleError(res, error);
    }
  });
  router.post('/shares/:id/revoke', async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.body ?? {};
      res.json({ success: true, data: { share: await shares.revoke(sessionId, req.params.id) } });
    } catch (error) {
      handleError(res, error);
    }
  });
  router.get('/shares/:id/comments', async (req: Request, res: Response) => {
    try {
      res.json({
        success: true,
        data: { comments: await shares.listComments(req.query.sessionId, req.params.id) },
      });
    } catch (error) {
      handleError(res, error);
    }
  });
  router.post('/shares/:id/comments/:commentId/resolve', async (req: Request, res: Response) => {
    try {
      const { sessionId, resolved } = req.body ?? {};
      res.json({
        success: true,
        data: {
          comment: await shares.setResolved(
            sessionId,
            req.params.id,
            req.params.commentId,
            resolved
          ),
        },
      });
    } catch (error) {
      handleError(res, error);
    }
  });
  return router;
}
