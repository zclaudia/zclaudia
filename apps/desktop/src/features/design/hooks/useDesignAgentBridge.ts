import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import type { DesignWorkbenchContext } from '@zclaudia/shared/wire/messages/design';
import { designFailure, registerDesignAgentBinding } from '../agent-bridge';
import { getDesignDeps, getDesignDocument } from '../api';
import { getCssDraftTable, type CssDraftIdentity } from '../css-drafts';
import type { DesignWorkspaceController } from '../workspace/controller';

export function designContext(
  controller: DesignWorkspaceController,
  identity: CssDraftIdentity
): DesignWorkbenchContext {
  const snapshot = controller.getSnapshot();
  const active = snapshot.pages.find(page => page.path === snapshot.activePath);
  const selection = active?.selection;
  return {
    activePage: active
      ? {
          path: active.path,
          diskRevision: active.docRevision,
          draftRevision: active.draftRevision,
          dirty: active.status !== 'clean',
          externalChange: active.externalChange,
          selection: selection
            ? {
                tagName: selection.tagName,
                elementPath: selection.elementPath,
                text: selection.text.slice(0, 300),
                sourceText: (selection.sourceText ?? selection.text).slice(0, 1000),
              }
            : null,
        }
      : null,
    pages: snapshot.pages.map(page => ({
      path: page.path,
      dirty: page.status !== 'clean',
      diskRevision: page.docRevision,
    })),
    dirtyStyles: Object.values(getCssDraftTable(identity).drafts)
      .filter(draft => draft.dirty)
      .map(draft => draft.path),
    viewport: snapshot.ui.viewport,
  };
}

interface Options {
  backendId: string;
  sessionId: string;
  identity: CssDraftIdentity;
  controller: DesignWorkspaceController;
  visible: boolean;
  previewHtml: string;
  previewMode: 'edit' | 'run';
  overviewOpen: boolean;
  channel: string;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  showCanvas: () => void;
}

/** Binds live state to the exact session; no background auto-save, reload, or script execution. */
export function useDesignAgentBridge(options: Options): () => void {
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });
  const loaded = useRef<{
    path: string | null;
    revision: string | null;
    html: string;
    frame: Window | null;
  } | null>(null);
  const pendingFrame = useRef<{
    token: string;
    path: string | null;
    revision: string | null;
    draftRevision: string;
    html: string;
    frame: Window | null;
  } | null>(null);
  const { backendId, sessionId, controller, identity } = options;
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const current = latest.current;
      const pending = pendingFrame.current;
      if (!pending || event.source !== current.iframeRef.current?.contentWindow) return;
      const data = event.data;
      if (
        data?.type === 'zclaudia:design-ready' &&
        data.channel === current.channel &&
        data.token === pending.token &&
        data.base === pending.draftRevision
      ) {
        loaded.current = pending;
        pendingFrame.current = null;
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);
  useEffect(
    () =>
      registerDesignAgentBinding(backendId, sessionId, {
        visible: () => latest.current.visible,
        context: () => designContext(controller, identity),
        present: async (request, alive) => {
          const path = request.path;
          if (!path) return designFailure('INVALID_ARGUMENT', 'A page path is required.');
          const initialRevision = controller
            .getSnapshot()
            .pages.find(page => page.path === path)?.docRevision;
          const canContinue = () => alive() && latest.current.visible;
          const hasDraft = () =>
            controller
              .getSnapshot()
              .pages.some(page => page.path === path && (page.status === 'dirty' || page.busy)) ||
            Object.values(getCssDraftTable(identity).drafts).some(draft => draft.dirty);
          if (hasDraft())
            return designFailure(
              'UNSAVED_CHANGES',
              'Save or discard the HTML/CSS drafts before presenting the disk version.'
            );
          const [document, deps] = await Promise.all([
            getDesignDocument(backendId, sessionId, path),
            getDesignDeps(backendId, sessionId, path),
          ]);
          if (!canContinue())
            return designFailure('CANCELLED', 'The Design session is no longer visible.');
          if (hasDraft())
            return designFailure(
              'UNSAVED_CHANGES',
              'The user edited the design while the request was loading.'
            );
          if (document.revision !== request.expectedRevision)
            return designFailure(
              'REVISION_CONFLICT',
              'The file changed before it could be displayed. Call present again for its new revision.'
            );
          const opened = await controller.open(path, canContinue);
          if (!opened.ok)
            return designFailure(
              'OPEN_FAILED',
              opened.reason === 'limit'
                ? 'Close an unsaved page before opening another.'
                : (opened.message ?? 'Unable to open page.')
            );
          // File discovery may already be loading this page. open() reuses that
          // entry, so wait for its document before treating it as a disk version.
          while (
            canContinue() &&
            controller.getSnapshot().pages.find(page => page.path === path)?.status === 'loading'
          ) {
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          if (!canContinue() || hasDraft())
            return designFailure('CANCELLED', 'The design changed while opening the page.');
          const openedRevision = controller
            .getSnapshot()
            .pages.find(page => page.path === path)?.docRevision;
          if (openedRevision !== initialRevision && openedRevision !== request.expectedRevision) {
            return designFailure(
              'REVISION_CONFLICT',
              'A newer document was loaded while presenting.'
            );
          }
          await controller.handleExternalDoc(document, () => canContinue() && !hasDraft());
          if (!canContinue() || hasDraft())
            return designFailure('CANCELLED', 'The design changed while refreshing the page.');
          controller.applyDepsStats(deps);
          latest.current.showCanvas();
          while (canContinue()) {
            const current = latest.current;
            const snapshot = controller.getSnapshot();
            const active = snapshot.pages.find(page => page.path === snapshot.activePath);
            if (
              snapshot.activePath !== path ||
              hasDraft() ||
              active?.docRevision !== request.expectedRevision
            ) {
              return designFailure(
                'DESIGN_CHANGED',
                'The selected page or document changed before display was acknowledged.'
              );
            }
            if (
              current.previewMode === 'edit' &&
              !current.overviewOpen &&
              current.previewHtml &&
              loaded.current?.path === path &&
              loaded.current.revision === request.expectedRevision &&
              loaded.current.html === current.previewHtml &&
              loaded.current.frame !== null &&
              loaded.current.frame === current.iframeRef.current?.contentWindow
            ) {
              return {
                ok: true,
                displayed: true,
                path,
                context: designContext(controller, identity),
              };
            }
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          return designFailure(
            'UI_TIMEOUT',
            'The preview did not finish loading in the visible Design panel.'
          );
        },
      }),
    [backendId, sessionId, controller, identity]
  );

  return () => {
    const current = latest.current;
    const snapshot = controller.getSnapshot();
    const active = snapshot.pages.find(page => page.path === snapshot.activePath);
    const token = crypto.randomUUID();
    loaded.current = null;
    pendingFrame.current = {
      token,
      path: snapshot.activePath,
      revision: active?.docRevision ?? null,
      draftRevision: active?.draftRevision ?? '',
      html: current.previewHtml,
      frame: current.iframeRef.current?.contentWindow ?? null,
    };
    current.iframeRef.current?.contentWindow?.postMessage(
      { type: 'zclaudia:design-ping', channel: current.channel, token },
      '*'
    );
  };
}
