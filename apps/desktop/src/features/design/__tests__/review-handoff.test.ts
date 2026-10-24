import { describe, expect, it } from 'vitest';
import type { DesignShareComment, DesignShareCommentTarget, DesignShareSummary } from '../api';
import { buildReviewHandoff, type ReviewHandoffInput } from '../review-handoff';

// 固定时间戳（确定性）；期望时间行用同一 toLocaleString 表达式计算，避免时区耦合
const COMMENT_TS = Date.UTC(2026, 9, 24, 4, 30, 0);
const SNAPSHOT_TS = Date.UTC(2026, 9, 23, 8, 0, 0);
const formatTime = (ts: number) => new Date(ts).toLocaleString('zh-CN', { hour12: false });

const PAGE_SOURCE = '<html><body><main><p id="intro">你好 世界</p></main></body></html>';
const TARGET: DesignShareCommentTarget = { elementPath: [0, 0], tagName: 'p', text: '你好 世界' };

const SHARE: DesignShareSummary = {
  id: 'share-1',
  token: 'token-abc',
  snapshotId: 'snap-1',
  entryPath: 'design/index.html',
  title: '首页改版',
  scope: 'link',
  createdAt: SNAPSHOT_TS,
  expiresAt: null,
  revokedAt: null,
  commentCount: 1,
  lastAccessAt: null,
};

const SNAPSHOT = { label: 'v3 定稿', createdAt: SNAPSHOT_TS, entryPath: 'design/index.html' };

const COMMENT: DesignShareComment = {
  id: 'c1',
  author: '林一',
  body: '请把这段标题换成蓝色，谢谢。',
  target: TARGET,
  createdAt: COMMENT_TS,
  resolvedAt: null,
};

const FULL_INPUT: ReviewHandoffInput = {
  comment: COMMENT,
  share: SHARE,
  snapshot: SNAPSHOT,
  snapshotSource: PAGE_SOURCE,
  currentSource: PAGE_SOURCE,
  currentDocPath: 'design/index.html',
};

const sectionByTitle = (sections: { title: string }[], title: string) =>
  sections.find(section => section.title === title);

const makeInput = (overrides: Partial<ReviewHandoffInput>): ReviewHandoffInput => ({
  ...FULL_INPUT,
  ...overrides,
});

describe('buildReviewHandoff（P7 §6.2 审阅进聊天交接）', () => {
  it('完整样例：快照锁定', () => {
    expect(buildReviewHandoff(FULL_INPUT)).toMatchSnapshot();
  });

  it('五 section 齐全且顺序固定：审阅反馈 / 分享版本 / 快照中的目标元素 / 当前版本定位 / 任务指令', () => {
    const { sections } = buildReviewHandoff(FULL_INPUT);
    expect(sections.map(section => section.title)).toEqual([
      'Review feedback',
      'Shared version',
      'Target element in the snapshot',
      'Location in the current version',
      'Instruction',
    ]);
  });

  it('审阅反馈：作者 + zh-CN 24 小时制本地时间 + 评论原文', () => {
    const { sections } = buildReviewHandoff(FULL_INPUT);
    expect(sectionByTitle(sections, 'Review feedback')?.body).toBe(
      ['- Author: 林一', `- Time: ${formatTime(COMMENT_TS)}`, '- Comment:', '请把这段标题换成蓝色，谢谢。'].join('\n')
    );
  });

  it('分享版本：label / 快照时间 / 入口 + 旧分享不变说明；label 为 null 写「无标签」', () => {
    const { sections } = buildReviewHandoff(FULL_INPUT);
    expect(sectionByTitle(sections, 'Shared version')?.body).toBe(
      [
        '- Label: v3 定稿',
        `- Snapshot time: ${formatTime(SNAPSHOT_TS)}`,
        '- Entry file: design/index.html',
        '- Existing shares still show this version; they will not change with this edit.',
      ].join('\n')
    );
    const unlabeled = buildReviewHandoff(makeInput({ snapshot: { ...SNAPSHOT, label: null } }));
    expect(sectionByTitle(unlabeled.sections, 'Shared version')?.body).toContain('- Label: No label');
  });

  it('命中：快照段与当前段都贴元素、折叠文本与源码片段', () => {
    const { sections } = buildReviewHandoff(FULL_INPUT);
    const snippet = '<p id="intro">你好 世界</p>';
    expect(sectionByTitle(sections, 'Target element in the snapshot')?.body).toBe(
      ['- Element: <p>', '- Collapsed text: 你好 世界', '- Snapshot source snippet:', snippet].join('\n')
    );
    expect(sectionByTitle(sections, 'Location in the current version')?.body).toBe(
      [
        '- Page: design/index.html',
        '- Element: <p>',
        '- Collapsed text: 你好 世界',
        '- Current source snippet:',
        snippet,
      ].join('\n')
    );
  });

  it('当前版本定位失效：三种原因逐字文案（路径越界 / 标签已变化 / 文本已变化）', () => {
    const expected = (reason: string) =>
      `The element anchor is no longer valid (${reason}). Locate the target element yourself using the comment description and the shared version, and state which element you located in your reply before making changes.`;

    const pathMissing = buildReviewHandoff(
      makeInput({ currentSource: '<body><div>其他内容</div></body>' })
    );
    expect(sectionByTitle(pathMissing.sections, 'Location in the current version')?.body).toBe(expected('Path out of range'));

    const tagMismatch = buildReviewHandoff(
      makeInput({ currentSource: '<body><section><span>你好 世界</span></section></body>' })
    );
    expect(sectionByTitle(tagMismatch.sections, 'Location in the current version')?.body).toBe(expected('Tag changed'));

    const textMismatch = buildReviewHandoff(
      makeInput({ currentSource: '<body><main><p id="intro">换成别的文本</p></main></body>' })
    );
    expect(sectionByTitle(textMismatch.sections, 'Location in the current version')?.body).toBe(expected('Text changed'));
  });

  it('快照源码不可用 / 当前源码不可用分支', () => {
    const noSnapshot = buildReviewHandoff(makeInput({ snapshotSource: null }));
    expect(sectionByTitle(noSnapshot.sections, 'Target element in the snapshot')?.body).toBe('Snapshot source unavailable.');

    const noCurrent = buildReviewHandoff(makeInput({ currentSource: null }));
    expect(sectionByTitle(noCurrent.sections, 'Location in the current version')?.body).toBe('Current source unavailable.');
  });

  it('整页评论（target null）：两段都写整页评论，当前段仍给页面路径', () => {
    const { sections } = buildReviewHandoff(makeInput({ comment: { ...COMMENT, target: null } }));
    expect(sectionByTitle(sections, 'Target element in the snapshot')?.body).toBe('Whole-page comment (not anchored to a specific element).');
    expect(sectionByTitle(sections, 'Location in the current version')?.body).toBe(
      ['- Page: design/index.html', 'Whole-page comment (not anchored to a specific element).'].join('\n')
    );
  });

  it('快照源码中也找不到目标（理论罕见）：如实写原因', () => {
    const { sections } = buildReviewHandoff(
      makeInput({ snapshotSource: '<body><section><span>你好 世界</span></section></body>' })
    );
    expect(sectionByTitle(sections, 'Target element in the snapshot')?.body).toBe(
      'Could not locate the target element in the snapshot source (Tag changed).'
    );
  });

  it('任务指令：当前路径；currentDocPath 为 null 回退「（未知路径）」', () => {
    const { sections } = buildReviewHandoff(FULL_INPUT);
    expect(sectionByTitle(sections, 'Instruction')?.body).toBe(
      'Please update the current page design/index.html based on the review feedback above. Keep everything unrelated to the feedback unchanged.'
    );
    const noPath = buildReviewHandoff(makeInput({ currentDocPath: null }));
    expect(sectionByTitle(noPath.sections, 'Instruction')?.body).toBe(
      'Please update the current page (unknown path) based on the review feedback above. Keep everything unrelated to the feedback unchanged.'
    );
    expect(sectionByTitle(noPath.sections, 'Location in the current version')?.body).toContain('- Page: (unknown path)');
  });

  it('prompt 格式：## 前缀块按 sections 顺序空行拼接', () => {
    const { sections, prompt } = buildReviewHandoff(FULL_INPUT);
    expect(prompt).toBe(sections.map(section => `## ${section.title}\n${section.body}`).join('\n\n'));
    expect(prompt.startsWith('## Review feedback\n')).toBe(true);
    const titles = ['Review feedback', 'Shared version', 'Target element in the snapshot', 'Location in the current version', 'Instruction'];
    let cursor = -1;
    for (const title of titles) {
      const at = prompt.indexOf(`## ${title}`);
      expect(at).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it('超长评论截断：原文截到 4000（含省略号）', () => {
    const long = 'x'.repeat(4500);
    const { sections, prompt } = buildReviewHandoff(
      makeInput({ comment: { ...COMMENT, body: long } })
    );
    const body = sectionByTitle(sections, 'Review feedback')?.body ?? '';
    const lastLine = body.split('\n').at(-1) ?? '';
    expect(lastLine).toBe('x'.repeat(3999) + '…');
    expect(lastLine).toHaveLength(4000);
    expect(prompt).not.toContain('xxxxxx'.repeat(700));
  });
});
