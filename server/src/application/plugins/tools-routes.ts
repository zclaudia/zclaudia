import { Router, type Request, type Response } from 'express';
import { sendApiError } from '../../interfaces/http/response.js';
import {
  createZClaudiaToolCatalog,
  resolveAgentToolScope,
  type ZClaudiaToolCatalogDeps,
} from './tool-catalog.js';

export type PluginToolsRoutesDeps = ZClaudiaToolCatalogDeps;

export function createPluginToolsRoutes(deps?: PluginToolsRoutesDeps): Router {
  const router = Router();
  const catalog = createZClaudiaToolCatalog(deps);

  router.get('/tools', (req: Request, res: Response) => {
    const sessionId =
      (req.query.sessionId as string | undefined) || deps?.resolveActiveSessionId?.();
    const sessionType = sessionId ? deps?.getSessionType?.(sessionId) : undefined;
    const callerScope = resolveAgentToolScope(sessionId, sessionType);
    const tools = catalog.listTools({ sessionId });
    console.log(`[PluginTools] list tools count=${tools.length} scope=${callerScope}`);
    res.json({ tools });
  });

  router.post('/tools/:name/execute', async (req: Request, res: Response) => {
    const { name } = req.params;
    const args = req.body.arguments || req.body.args || {};
    const context = {
      sessionId: (req.body.sessionId as string | undefined) || deps?.resolveActiveSessionId?.(),
    };
    const sessionTag = context.sessionId || 'none';
    const sessionType = context.sessionId ? deps?.getSessionType?.(context.sessionId) : undefined;
    const callerScope = resolveAgentToolScope(context.sessionId, sessionType);

    try {
      console.log(
        `[PluginTools] execute start name=${name} session=${sessionTag} scope=${callerScope} args=${Object.keys(args).join(',') || 'none'}`
      );
      const result = await catalog.callTool(name, args, {
        ...context,
        signal: AbortSignal.timeout(30_000),
      });
      console.log(
        `[PluginTools] execute ok name=${name} session=${sessionTag} resultLength=${String(result).length}`
      );
      res.json({ result });
    } catch (error) {
      console.error(`[PluginTools] execute failed name=${name} session=${sessionTag}:`, error);
      sendApiError(
        res,
        500,
        'TOOL_EXECUTION_FAILED',
        `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });

  return router;
}
