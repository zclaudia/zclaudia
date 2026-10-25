import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesignWorkbenchRequest } from '@zclaudia/shared/wire/messages/design';
import { designContext, useDesignAgentBridge } from '../hooks/useDesignAgentBridge';
import type { DesignAgentBinding } from '../agent-bridge';
import { DesignWorkspaceController } from '../workspace/controller';
import type { DesignWorkspacePorts } from '../workspace/ports';
import { sha256HexSync } from '../html/hash';
import { applyCssEdit, discardAllCssDrafts, openCssDraft } from '../css-drafts';
import * as api from '../api';

const host = vi.hoisted(() => ({ binding: null as DesignAgentBinding | null }));
vi.mock('../agent-bridge', () => ({
  designFailure: (code: string, message: string) => ({ ok: false, code, message }),
  registerDesignAgentBinding: (_backend: string, _session: string, binding: DesignAgentBinding) => {
    host.binding = binding;
    return () => {
      host.binding = null;
    };
  },
}));
vi.mock('../api', () => ({ getDesignDocument: vi.fn(), getDesignDeps: vi.fn() }));

const path = 'design/settings.html';
const source = '<html><body><h1>Settings</h1></body></html>';
const doc = { path, source, revision: sha256HexSync(source) };
const identity = { backendId: 'b', workingDirectory: '/design-bridge-test' };
const request = (): DesignWorkbenchRequest => ({
  type: 'design_workbench_request',
  requestId: 'r',
  sessionId: 's',
  action: 'present',
  path,
  expectedRevision: doc.revision,
  expiresAt: Date.now() + 1000,
});
let controller: DesignWorkspaceController;
let ports: DesignWorkspacePorts;
beforeEach(async () => {
  vi.clearAllMocks();
  discardAllCssDrafts();
  const deps = { entry: { path, size: source.length, mtimeMs: 1 }, files: [], skipped: [] };
  vi.mocked(api.getDesignDocument).mockResolvedValue(doc);
  vi.mocked(api.getDesignDeps).mockResolvedValue(deps);
  ports = {
    getDocument: vi.fn(async () => doc),
    putDocument: vi.fn(),
    listDeps: vi.fn(async () => deps),
    createSnapshot: vi.fn(),
    sha256: async value => sha256HexSync(value),
  };
  controller = new DesignWorkspaceController(crypto.randomUUID(), () => ports);
  await controller.open(path);
});
afterEach(() => {
  controller.dispose();
  discardAllCssDrafts();
  vi.useRealTimers();
});

function mount() {
  const frame = document.createElement('iframe');
  document.body.appendChild(frame);
  const post = vi.spyOn(frame.contentWindow!, 'postMessage');
  const options = {
    backendId: 'b',
    sessionId: 's',
    identity,
    controller,
    visible: true,
    previewHtml: '<html>preview</html>',
    previewMode: 'edit' as const,
    overviewOpen: false,
    channel: 'channel',
    iframeRef: { current: frame },
    showCanvas: vi.fn(),
  };
  const hook = renderHook(() => useDesignAgentBridge(options));
  const ready = (overrides = {}, wrongSource = false) => {
    act(() => hook.result.current());
    const ping = post.mock.calls.at(-1)![0];
    act(() =>
      window.dispatchEvent(
        new MessageEvent('message', {
          source: wrongSource ? window : frame.contentWindow,
          data: {
            type: 'zclaudia:design-ready',
            channel: 'channel',
            token: ping.token,
            base: doc.revision,
            ...overrides,
          },
        })
      )
    );
  };
  return {
    ...hook,
    options,
    ready,
    close: () => {
      hook.unmount();
      frame.remove();
    },
  };
}

describe('live Design agent binding', () => {
  it('returns the active path, selection, revisions and viewport from live state', () => {
    controller.handleSelectionMessage({
      tagName: 'h1',
      text: 'Settings',
      sourceText: 'Settings',
      elementPath: [0],
      base: doc.revision,
    });
    expect(designContext(controller, identity)).toMatchObject({
      activePage: {
        path,
        dirty: false,
        diskRevision: doc.revision,
        selection: { tagName: 'h1', elementPath: [0] },
      },
      dirtyStyles: [],
    });
  });

  it('acknowledges only a loaded preview from the right frame, channel and revision', async () => {
    const hook = mount();
    let settled = false;
    const pending = host
      .binding!.present(request(), () => true)
      .then(value => {
        settled = true;
        return value;
      });
    await waitFor(() => expect(hook.options.showCanvas).toHaveBeenCalled());
    hook.ready({}, true);
    hook.ready({ channel: 'wrong' });
    hook.ready({ base: 'stale' });
    expect(settled).toBe(false);
    hook.ready();
    await expect(pending).resolves.toMatchObject({ ok: true, displayed: true, path });
    expect(ports.putDocument).not.toHaveBeenCalled();
    hook.close();
  });

  it('refuses an unsaved HTML draft without reading or writing disk', async () => {
    await controller.applySource('<h1>Unsaved</h1>', 'user edit');
    const hook = mount();
    await expect(host.binding!.present(request(), () => true)).resolves.toMatchObject({
      ok: false,
      code: 'UNSAVED_CHANGES',
    });
    expect(api.getDesignDocument).not.toHaveBeenCalled();
    expect(controller.getSnapshot().pages[0]!.source).toContain('Unsaved');
    hook.close();
  });

  it('does not reuse a display acknowledgement from a replaced iframe', async () => {
    const hook = mount();
    hook.ready();
    const replacement = document.createElement('iframe');
    document.body.appendChild(replacement);
    hook.options.iframeRef.current = replacement;
    let alive = true;
    let settled = false;
    const pending = host
      .binding!.present(request(), () => alive)
      .then(result => {
        settled = true;
        return result;
      });
    await waitFor(() => expect(hook.options.showCanvas).toHaveBeenCalled());
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(settled).toBe(false);
    alive = false;
    await expect(pending).resolves.toMatchObject({ ok: false });
    replacement.remove();
    hook.close();
  });

  it('reports and refuses dirty external CSS too', async () => {
    const css = openCssDraft(identity, 'design/style.css', {
      source: 'h1 { color: red; }',
      revision: 'css-r1',
    });
    applyCssEdit(identity, css.path, css.revision, {
      rulePath: [0],
      property: 'color',
      value: 'blue',
      create: false,
    });
    const hook = mount();
    expect(host.binding!.context().dirtyStyles).toEqual(['design/style.css']);
    await expect(host.binding!.present(request(), () => true)).resolves.toMatchObject({
      ok: false,
      code: 'UNSAVED_CHANGES',
    });
    hook.close();
  });

  it('does not activate a page when cancelled during document fetch', async () => {
    let resolve!: (value: typeof doc) => void;
    vi.mocked(api.getDesignDocument).mockReturnValue(
      new Promise(done => {
        resolve = done;
      })
    );
    const hook = mount();
    const open = vi.spyOn(controller, 'open');
    let alive = true;
    const pending = host.binding!.present(request(), () => alive);
    alive = false;
    resolve(doc);
    await expect(pending).resolves.toMatchObject({ ok: false, code: 'CANCELLED' });
    expect(open).not.toHaveBeenCalled();
    hook.close();
  });

  it('rejects a file revision changed after the server validated it', async () => {
    const hook = mount();
    await expect(
      host.binding!.present({ ...request(), expectedRevision: 'older' }, () => true)
    ).resolves.toMatchObject({ ok: false, code: 'REVISION_CONFLICT' });
    expect(hook.options.showCanvas).not.toHaveBeenCalled();
    hook.close();
  });
});
