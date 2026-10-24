import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyCssEdit,
  commitCssDraft,
  cssDraftEpoch,
  dirtyCssPaths,
  discardAllCssDrafts,
  discardCssDraft,
  encodeBase64Utf8,
  getCssDraft,
  getCssDraftTable,
  openCssDraft,
  redoCssDraft,
  subscribeCssDrafts,
  undoCssDraft,
} from '../css-drafts';
import type { CssDraftIdentity } from '../css-drafts';
import type { CssSourceEdit } from '../css-source';
import { sha256HexSync } from '../html/hash';
import { DesignEditError } from '../types';

const identity: CssDraftIdentity = { backendId: 'css-draft-b', projectId: 'css-draft-p', workingDirectory: '/css-draft-w' };
const otherIdentity: CssDraftIdentity = { backendId: 'css-draft-b2', projectId: 'css-draft-p', workingDirectory: '/css-draft-w' };
const PATH = 'design/css/main.css';

/**
 * 与 edit-engine styleBlock 用例同口径的样式文本：多行声明、!important、
 * @media 嵌套、未终结末声明、空规则。
 */
const CSS = [
  'h1 {',
  '  color: #f00;',
  '  padding-top: 8px;',
  '  font-weight: bold !important;',
  '}',
  '@media (min-width: 600px) {',
  '  .card { color: #00f }',
  '}',
  '.wrap {',
  '  border-width: 1px;',
  '  border-style: solid',
  '}',
  '.empty {}',
].join('\n');

/** 打开测试草稿（beforeEach 已清空），返回草稿当前修订（applyCssEdit 的 baseRevision 入参）。 */
function opened(path = PATH, source = CSS, revision = `disk-${sha256HexSync(source)}`): string {
  return openCssDraft(identity, path, { source, revision }).revision;
}

const apply = (path: string, baseRevision: string, edit: CssSourceEdit) =>
  applyCssEdit(identity, path, baseRevision, edit);

beforeEach(() => {
  discardAllCssDrafts();
});

describe('css-drafts（P3.5 第二批 C6：外部 .css 进程内草稿表）', () => {
  describe('applyCssEdit：三种动作逐字节保持（对齐 edit-engine 用例口径）', () => {
    it('改值仅替换值子区间，其余逐字节保持；revision = sha256(新全文)', () => {
      const { source, revision } = apply(PATH, opened(), {
        rulePath: [0],
        property: 'color',
        value: '#ff0000',
        create: false,
      });
      expect(source).toBe(CSS.replace('color: #f00;', 'color: #ff0000;'));
      expect(revision).toBe(sha256HexSync(source));
    });

    it('改值保留 !important 后缀于值区间之外', () => {
      const { source } = apply(PATH, opened(), {
        rulePath: [0],
        property: 'font-weight',
        value: '700',
        create: false,
      });
      expect(source).toBe(CSS.replace('font-weight: bold !important;', 'font-weight: 700 !important;'));
    });

    it('删除：中间声明连同前导空白与分号整体移除', () => {
      const { source } = apply(PATH, opened(), {
        rulePath: [0],
        property: 'padding-top',
        value: null,
        create: false,
      });
      expect(source).toBe(CSS.replace('\n  padding-top: 8px;', ''));
    });

    it('删除：未终结的末声明不留孤立分号', () => {
      const { source } = apply(PATH, opened(), {
        rulePath: [2],
        property: 'border-style',
        value: null,
        create: false,
      });
      expect(source).toBe(CSS.replace('\n  border-style: solid', ''));
    });

    it('新增：多行规则内按既有声明样式插入，末声明缺分号时前置修复', () => {
      const { source } = apply(PATH, opened(), {
        rulePath: [2],
        property: 'margin-top',
        value: '4px',
        create: true,
      });
      expect(source).toBe(
        CSS.replace('  border-style: solid\n}', '  border-style: solid\n;\n  margin-top: 4px;}')
      );
    });

    it('新增：@media 嵌套规则内同口径（rulePath 两级）', () => {
      const { source } = apply(PATH, opened(), {
        rulePath: [1, 0],
        property: 'margin-top',
        value: '4px',
        create: true,
      });
      expect(source).toBe(CSS.replace('color: #00f }', 'color: #00f ; margin-top: 4px;}'));
    });

    it('新增：空规则按选择器行缩进 + 两空格插入', () => {
      const { source } = apply(PATH, opened(), {
        rulePath: [3],
        property: 'color',
        value: 'red',
        create: true,
      });
      expect(source).toBe(CSS.replace('.empty {}', '.empty {\n  color: red;}'));
    });

    it('非法值 / 属性不存在 / 定位失败 / 相同值：报错且原文不动', () => {
      const base = opened();
      expect(() =>
        apply(PATH, base, { rulePath: [0], property: 'color', value: 'url(evil.png)', create: false })
      ).toThrowError(DesignEditError);
      expect(() =>
        apply(PATH, base, { rulePath: [0], property: 'display', value: null, create: false })
      ).toThrowError(DesignEditError);
      expect(() =>
        apply(PATH, base, { rulePath: [9], property: 'color', value: 'blue', create: false })
      ).toThrowError(DesignEditError);
      expect(() =>
        apply(PATH, base, { rulePath: [0], property: 'color', value: '#f00', create: false })
      ).toThrowError(DesignEditError);
      expect(getCssDraft(identity, PATH)?.source).toBe(CSS);
    });

    it('草稿未打开 / baseRevision 陈旧：拒绝（防御并发写）', () => {
      expect(() =>
        apply(PATH, 'whatever', { rulePath: [0], property: 'color', value: 'blue', create: false })
      ).toThrowError(/not open/);
      const base = opened();
      expect(() =>
        apply(PATH, `${base}-stale`, { rulePath: [0], property: 'color', value: 'blue', create: false })
      ).toThrowError(DesignEditError);
    });
  });

  describe('历史：同键合并与有界（尺寸/合并窗口同 HISTORY_OPTIONS）', () => {
    it('合并窗口内同键连续编辑折叠为一条撤销记录（undo 一步回基线）', () => {
      const base = opened();
      const mid = apply(PATH, base, {
        rulePath: [0],
        property: 'color',
        value: 'green',
        create: false,
      }).revision;
      apply(PATH, mid, { rulePath: [0], property: 'color', value: 'blue', create: false });
      expect(getCssDraft(identity, PATH)!.source).toContain('color: blue');
      expect(undoCssDraft(identity, PATH)).toBe(true);
      expect(getCssDraft(identity, PATH)!.source).toBe(CSS);
      expect(undoCssDraft(identity, PATH)).toBe(false);
    });

    it('不同键各自成条：undo 两步逐级回退，redo 对称', () => {
      const base = opened();
      const mid = apply(PATH, base, {
        rulePath: [0],
        property: 'color',
        value: 'green',
        create: false,
      }).revision;
      apply(PATH, mid, { rulePath: [0], property: 'padding-top', value: '1px', create: false });
      expect(undoCssDraft(identity, PATH)).toBe(true);
      expect(getCssDraft(identity, PATH)!.source).toContain('color: green');
      expect(undoCssDraft(identity, PATH)).toBe(true);
      expect(getCssDraft(identity, PATH)!.source).toBe(CSS);
      expect(undoCssDraft(identity, PATH)).toBe(false);
      expect(redoCssDraft(identity, PATH)).toBe(true);
      expect(getCssDraft(identity, PATH)!.source).toContain('color: green');
    });

    it('超过 limit(100) 条后最旧记录被淘汰（undo 步数有界）', () => {
      let current = opened();
      for (let i = 0; i < 105; i += 1) {
        current = apply(PATH, current, {
          rulePath: [0],
          property: `prop-${i}`,
          value: '1px',
          create: true,
        }).revision;
      }
      let steps = 0;
      while (undoCssDraft(identity, PATH)) steps += 1;
      expect(steps).toBeLessThanOrEqual(100);
      expect(steps).toBeGreaterThan(0);
    });
  });

  describe('纪元与快照', () => {
    it('draftEpoch 每文件自增；工作区 cssDraftEpoch 任一文件 apply 自增', () => {
      const base = opened();
      const other = openCssDraft(identity, 'other.css', { source: 'a { color: #f00; }', revision: 'r-o' });
      const epoch0 = cssDraftEpoch(identity);
      const fileEpoch0 = getCssDraft(identity, PATH)!.draftEpoch;
      apply(PATH, base, { rulePath: [0], property: 'color', value: 'blue', create: false });
      expect(getCssDraft(identity, PATH)!.draftEpoch).toBe(fileEpoch0 + 1);
      expect(getCssDraft(identity, 'other.css')!.draftEpoch).toBe(0);
      const afterFirst = cssDraftEpoch(identity);
      expect(afterFirst).toBe(epoch0 + 1);
      applyCssEdit(identity, 'other.css', other.revision, {
        rulePath: [0],
        property: 'color',
        value: 'blue',
        create: false,
      });
      expect(cssDraftEpoch(identity)).toBe(afterFirst + 1);
    });

    it('快照引用稳定、变更即换新对象；subscribe 通知监听者', () => {
      const first = getCssDraftTable(identity);
      expect(getCssDraftTable(identity)).toBe(first);
      const listener = vi.fn();
      const unsubscribe = subscribeCssDrafts(listener);
      apply(PATH, opened(), { rulePath: [0], property: 'color', value: 'blue', create: false });
      const second = getCssDraftTable(identity);
      expect(second).not.toBe(first);
      expect(second.version).toBeGreaterThan(first.version);
      expect(second.epoch).toBeGreaterThan(first.epoch);
      expect(second.drafts[PATH]?.dirty).toBe(true);
      expect(listener).toHaveBeenCalled();
      unsubscribe();
    });

    it('工作区按 identity 隔离：另一 identity 看不到草稿', () => {
      opened();
      expect(getCssDraft(otherIdentity, PATH)).toBeNull();
      expect(dirtyCssPaths(otherIdentity)).toEqual([]);
      expect(getCssDraftTable(otherIdentity).drafts).toEqual({});
    });
  });

  describe('生命周期：打开 / 保存 / 重载', () => {
    it('openCssDraft 建立干净基线；保存提交清 dirty 并更新 baseRevision', () => {
      const status = openCssDraft(identity, PATH, { source: CSS, revision: 'disk-rev-1' });
      expect(status.dirty).toBe(false);
      expect(status.source).toBe(CSS);
      expect(status.baseRevision).toBe('disk-rev-1');
      const { source } = apply(PATH, status.revision, {
        rulePath: [0],
        property: 'color',
        value: 'blue',
        create: false,
      });
      expect(dirtyCssPaths(identity)).toEqual([PATH]);
      commitCssDraft(identity, PATH, { source, revision: 'saved-rev-2' });
      const committed = getCssDraft(identity, PATH)!;
      expect(committed.dirty).toBe(false);
      expect(committed.baseRevision).toBe('saved-rev-2');
      expect(committed.source).toBe(source);
      expect(dirtyCssPaths(identity)).toEqual([]);
      // 保存后仍可撤销（历史保留，与 controller.save 的 markSaved 同口径）。
      expect(undoCssDraft(identity, PATH)).toBe(true);
    });

    it('干净草稿遇磁盘变化重新采纳；脏草稿保留（磁盘变化交由 409 冲突路径）', () => {
      openCssDraft(identity, PATH, { source: CSS, revision: 'disk-rev-1' });
      // 干净 + 磁盘变化 → 采纳。
      const adopted = openCssDraft(identity, PATH, {
        source: 'h1 { color: #00f; }',
        revision: 'disk-rev-2',
      });
      expect(adopted.source).toBe('h1 { color: #00f; }');
      expect(adopted.baseRevision).toBe('disk-rev-2');
      // 脏 + 磁盘再变 → 保留草稿。
      apply(PATH, opened(PATH, 'h1 { color: #00f; }', 'disk-rev-2'), {
        rulePath: [0],
        property: 'color',
        value: 'green',
        create: false,
      });
      const kept = openCssDraft(identity, PATH, { source: 'h1 { color: #000; }', revision: 'disk-rev-3' });
      expect(kept.dirty).toBe(true);
      expect(kept.source).toContain('color: green');
      expect(kept.baseRevision).toBe('disk-rev-2');
    });

    it('discardCssDraft 删除记录；重开后可继续编辑（reload 口径）', () => {
      const base = opened();
      apply(PATH, base, { rulePath: [0], property: 'color', value: 'blue', create: false });
      discardCssDraft(identity, PATH);
      expect(getCssDraft(identity, PATH)).toBeNull();
      expect(dirtyCssPaths(identity)).toEqual([]);
      const reopened = openCssDraft(identity, PATH, { source: CSS, revision: 'disk-rev-9' });
      const { source } = applyCssEdit(identity, PATH, reopened.revision, {
        rulePath: [0],
        property: 'color',
        value: 'blue',
        create: false,
      });
      expect(source).toContain('color: blue');
    });

    it('discardAllCssDrafts 清空（指定 identity / 全部）', () => {
      opened();
      openCssDraft(otherIdentity, PATH, { source: 'a {}', revision: 'r' });
      discardAllCssDrafts(identity);
      expect(getCssDraft(identity, PATH)).toBeNull();
      expect(getCssDraft(otherIdentity, PATH)).not.toBeNull();
      discardAllCssDrafts();
      expect(getCssDraft(otherIdentity, PATH)).toBeNull();
    });
  });

  describe('encodeBase64Utf8', () => {
    it('utf8 → base64（preview.decodeBase64Utf8 的逆）', () => {
      expect(encodeBase64Utf8('h1 { color: #f00; }')).toBe(btoa('h1 { color: #f00; }'));
      const decoded = new TextDecoder().decode(
        Uint8Array.from(atob(encodeBase64Utf8('颜色 { color: 红; }')), char => char.charCodeAt(0))
      );
      expect(decoded).toBe('颜色 { color: 红; }');
    });
  });
});
