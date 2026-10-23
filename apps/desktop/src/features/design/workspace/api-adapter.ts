import { createDesignSnapshot, getDesignDeps, getDesignDocument, putDesignDocument } from '../api';
import { sha256Hex } from '../html/hash';
import type { DesignWorkspacePorts } from './ports';

/**
 * Bind the design HTTP API (api.ts) to the controller ports contract
 * (workspace/ports.ts) for one backendId + sessionId. The controller calls
 * `getPorts(sessionId)` per action, so a rebound workspace picks up fresh
 * ports bound to the new session.
 */
export function createWorkspacePorts(backendId: string, sessionId: string): DesignWorkspacePorts {
  return {
    getDocument: path => getDesignDocument(backendId, sessionId, path),
    putDocument: req =>
      putDesignDocument(backendId, {
        sessionId,
        path: req.path,
        source: req.source,
        expectedRevision: req.expectedRevision,
        ...(req.allowCreate === undefined ? {} : { allowCreate: req.allowCreate }),
      }),
    listDeps: path => getDesignDeps(backendId, sessionId, path),
    createSnapshot: (path, source) => createDesignSnapshot(backendId, { sessionId, path, source }),
    sha256: source => sha256Hex(source),
  };
}
