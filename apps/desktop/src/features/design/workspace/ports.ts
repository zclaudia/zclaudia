import type { DesignDepsResult, DesignDocument } from '../types';

/**
 * Everything the workspace controller needs from the host (P2 §1.3). Bound to
 * a single backendId + sessionId; tests inject a fake implementation.
 */
export interface DesignWorkspacePorts {
  getDocument(path: string): Promise<DesignDocument>;
  putDocument(req: {
    path: string;
    source: string;
    /** 重建保存（文件已被删除）时为 ''，并附 allowCreate。 */
    expectedRevision: string;
    allowCreate?: boolean;
  }): Promise<DesignDocument>;
  listDeps(path: string): Promise<DesignDepsResult>;
  /** 保存成功后的自动快照；失败只降级为提示，不算保存失败。 */
  createSnapshot(path: string, source: 'save' | 'manual'): Promise<unknown>;
  sha256(source: string): Promise<string>;
}

/** Ports are re-created per session so a rebound controller uses fresh auth. */
export type DesignWorkspacePortsFactory = (sessionId: string) => DesignWorkspacePorts;
