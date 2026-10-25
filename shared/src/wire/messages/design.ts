/** Session-bound Design workbench requests. No arbitrary frontend code execution. */
export interface DesignWorkbenchContext {
  activePage: {
    path: string;
    diskRevision: string | null;
    draftRevision: string;
    dirty: boolean;
    externalChange: boolean;
    selection: {
      tagName: string;
      elementPath: number[];
      text: string;
      sourceText: string;
    } | null;
  } | null;
  pages: Array<{ path: string; dirty: boolean; diskRevision: string | null }>;
  dirtyStyles: string[];
  viewport: { preset: string; width: number | null };
}

export interface DesignWorkbenchRequest {
  type: 'design_workbench_request';
  requestId: string;
  sessionId: string;
  expiresAt: number;
  action: 'get_context' | 'present';
  path?: string;
  expectedRevision?: string;
}

export type DesignWorkbenchResult =
  | { ok: true; context: DesignWorkbenchContext; displayed: boolean; path?: string }
  | { ok: false; code: string; message: string };

export interface DesignWorkbenchResponse {
  type: 'design_workbench_response';
  requestId: string;
  sessionId: string;
  result: DesignWorkbenchResult;
}

export interface DesignWorkbenchCancel {
  type: 'design_workbench_cancel';
  requestId: string;
  sessionId: string;
}
