import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AcpPermissionBridge } from '../acp-permissions.js';

const SIGNAL = new AbortController().signal;
const OPTIONS = [
  { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' as const },
  { optionId: 'allow-always', name: 'Always allow', kind: 'allow_always' as const },
  { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' as const },
];

let tmp: string;
let extra: string;
let third: string;

beforeAll(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-addl-')));
  extra = path.join(tmp, 'extra');
  third = path.join(tmp, 'third');
  fs.mkdirSync(extra);
  fs.mkdirSync(third);
  fs.mkdirSync(path.join(tmp, 'extra-sibling'));
  fs.symlinkSync(third, path.join(extra, 'escape'));
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function editRequest(...paths: string[]) {
  return {
    sessionId: 's1',
    toolCall: {
      toolCallId: 't1',
      kind: 'edit' as const,
      title: `Write ${paths[0]}`,
      status: 'pending' as const,
      content: paths.map(p => ({
        type: 'diff' as const,
        path: p,
        oldText: null,
        newText: 'x\n',
      })),
    },
    options: OPTIONS,
  };
}

function executeRequest(command: string) {
  return {
    sessionId: 's1',
    toolCall: {
      toolCallId: 't2',
      kind: 'execute' as const,
      title: `\`${command}\``,
      status: 'pending' as const,
      rawInput: { command },
    },
    options: OPTIONS,
  };
}

function bridge(
  onPermission: ReturnType<typeof vi.fn>,
  extras: Partial<ConstructorParameters<typeof AcpPermissionBridge>[0]> = {}
) {
  return new AcpPermissionBridge({
    supervised: true,
    onPermission,
    additionalDirectories: [extra],
    ...extras,
  });
}

describe('AcpPermissionBridge additional directories', () => {
  it('auto-allows an edit whose diff path is inside an additional directory', async () => {
    const onPermission = vi.fn().mockResolvedValue({ behavior: 'deny' });
    const b = bridge(onPermission);
    const response = await b.handleRequest(
      editRequest(path.join(extra, 'sub', 'a.txt')) as never,
      SIGNAL
    );
    expect(response.outcome).toEqual({ outcome: 'selected', optionId: 'allow-once' });
    expect(b.decisionFor('t1')).toBe('allowed');
    expect(onPermission).not.toHaveBeenCalled();
  });

  it('sends edits outside every additional directory to the host', async () => {
    const onPermission = vi.fn().mockResolvedValue({ behavior: 'deny' });
    const b = bridge(onPermission);
    const response = await b.handleRequest(editRequest(path.join(third, 'a.txt')) as never, SIGNAL);
    expect(onPermission).toHaveBeenCalledTimes(1);
    expect(response.outcome).toEqual({ outcome: 'selected', optionId: 'reject-once' });
  });

  it.each([
    ['traversal', () => path.join(extra, '..', 'third', 'a.txt')],
    ['prefix collision', () => path.join(tmp, 'extra-sibling', 'a.txt')],
    ['symlink escape', () => path.join(extra, 'escape', 'a.txt')],
    ['relative path', () => 'extra/a.txt'],
  ])('does not auto-allow %s', async (_name, target) => {
    const onPermission = vi.fn().mockResolvedValue({ behavior: 'deny' });
    await bridge(onPermission).handleRequest(editRequest(target()) as never, SIGNAL);
    expect(onPermission).toHaveBeenCalledTimes(1);
  });

  it('requires every diff path to be inside an additional directory', async () => {
    const onPermission = vi.fn().mockResolvedValue({ behavior: 'deny' });
    await bridge(onPermission).handleRequest(
      editRequest(path.join(extra, 'a.txt'), path.join(third, 'b.txt')) as never,
      SIGNAL
    );
    expect(onPermission).toHaveBeenCalledTimes(1);
  });

  it('keeps shell requests on the normal approval flow', async () => {
    const onPermission = vi.fn().mockResolvedValue({ behavior: 'allow' });
    const b = bridge(onPermission);
    await b.handleRequest(executeRequest(`echo x > ${path.join(extra, 'a.txt')}`) as never, SIGNAL);
    expect(onPermission).toHaveBeenCalledTimes(1);
  });

  it('does not auto-allow an edit request that has no diff content', async () => {
    const onPermission = vi.fn().mockResolvedValue({ behavior: 'deny' });
    const request = editRequest(path.join(extra, 'a.txt'));
    (request.toolCall as { content: unknown[] }).content = [];
    await bridge(onPermission).handleRequest(request as never, SIGNAL);
    expect(onPermission).toHaveBeenCalledTimes(1);
  });

  it('behaves as before without additional directories', async () => {
    const onPermission = vi.fn().mockResolvedValue({ behavior: 'deny' });
    const b = bridge(onPermission, { additionalDirectories: undefined });
    await b.handleRequest(editRequest(path.join(extra, 'a.txt')) as never, SIGNAL);
    expect(onPermission).toHaveBeenCalledTimes(1);
  });

  it('denies (not allow_always) when no allow_once option is offered', async () => {
    const onPermission = vi.fn();
    const onAutoDeny = vi.fn();
    const request = editRequest(path.join(extra, 'a.txt'));
    request.options = [{ optionId: 'reject-once', name: 'Reject', kind: 'reject_once' as never }];
    const b = bridge(onPermission, { onAutoDeny });
    const response = await b.handleRequest(request as never, SIGNAL);
    expect(response.outcome).toEqual({ outcome: 'selected', optionId: 'reject-once' });
    expect(b.decisionFor('t1')).toBe('denied');
    expect(onAutoDeny).toHaveBeenCalled();
  });
});
