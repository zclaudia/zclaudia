/**
 * P7 §6.2 审阅进聊天交接（S5 纯函数）。
 *
 * buildReviewHandoff 把一条分享评论 + 分享版本信息 + 快照/当前两份源码的定位
 * 结果，组装为 agent-context.ts 风格的中文 sections 与最终 prompt
 * （`## <title>\n<body>` 块以空行拼接，空 section 整省——本卡五段恒有内容，
 * 仍保留防御性省略）。
 *
 * 定位失效不阻塞交接（评论本身往往足以描述意图），但明确写失效原因并要求
 * Agent 修改前自证定位，绝不静默假定挂到了哪个元素（P7.2 红线）。
 */

import type { DesignShareComment, DesignShareSummary } from './api';
import { LOCATOR_REASON_TEXT, matchCommentTarget, truncateText } from './comment-locator';

export interface ReviewHandoffInput {
  comment: DesignShareComment;
  share: DesignShareSummary;
  snapshot: { label: string | null; createdAt: number; entryPath: string };
  /** 快照入口 HTML（getDesignSnapshotFile base64 解码；拿不到为 null）。 */
  snapshotSource: string | null;
  /** 当前磁盘入口 HTML。 */
  currentSource: string | null;
  currentDocPath: string | null;
}

export interface ReviewHandoffSection {
  title: string;
  body: string;
}

/** 评论原文上限。 */
const COMMENT_BODY_LIMIT = 4000;

/** 本地时间（zh-CN 24 小时制），评论与快照共用同一口径。 */
function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

/** 失效原因中文短语（match.reason 理论上恒有，兜底防 undefined）。 */
function reasonText(reason: string | undefined): string {
  return (reason && LOCATOR_REASON_TEXT[reason as keyof typeof LOCATOR_REASON_TEXT]) || '未知原因';
}

/** 「快照中的目标元素」段：快照源码 / 整页评论 / 命中切片 / 罕见失效如实写原因。 */
function snapshotTargetBody(comment: DesignShareComment, snapshotSource: string | null): string {
  if (snapshotSource === null) return '快照源码不可用。';
  if (comment.target === null) return '整页评论（未定位到具体元素）。';
  const match = matchCommentTarget(snapshotSource, comment.target);
  if (!match.matched) {
    return `未能在快照源码中定位目标元素（${reasonText(match.reason)}）。`;
  }
  const lines = [`- 元素：<${comment.target.tagName}>`];
  if (match.text !== undefined) lines.push(`- 折叠文本：${match.text}`);
  if (match.snippet !== undefined) lines.push('- 快照源码片段：', match.snippet);
  return lines.join('\n');
}

/** 「当前版本定位」段：命中给路径 + 切片；失效给逐字文案并要求自证定位。 */
function currentTargetBody(
  comment: DesignShareComment,
  currentSource: string | null,
  currentDocPath: string | null
): string {
  if (currentSource === null) return '当前源码不可用。';
  const path = currentDocPath ?? '（未知路径）';
  if (comment.target === null) {
    return [`- 页面：${path}`, '整页评论（未定位到具体元素）。'].join('\n');
  }
  const match = matchCommentTarget(currentSource, comment.target);
  if (!match.matched) {
    return (
      `元素定位已失效（${reasonText(match.reason)}）。` +
      '请依据评论描述与分享版本对比自行定位目标元素，修改前在回复中说明你定位到的元素。'
    );
  }
  const lines = [`- 页面：${path}`, `- 元素：<${comment.target.tagName}>`];
  if (match.text !== undefined) lines.push(`- 折叠文本：${match.text}`);
  if (match.snippet !== undefined) lines.push('- 当前源码片段：', match.snippet);
  return lines.join('\n');
}

/**
 * 组装审阅交接。sections 顺序固定：审阅反馈 / 分享版本 / 快照中的目标元素 /
 * 当前版本定位 / 任务指令；prompt = 各段 `## <title>\n<body>` 空行拼接。
 */
export function buildReviewHandoff(input: ReviewHandoffInput): {
  sections: ReviewHandoffSection[];
  prompt: string;
} {
  // share（DesignShareSummary）为契约入参，段落内容只用 snapshot 的 label/时间/入口。
  const { comment, snapshot, snapshotSource, currentSource, currentDocPath } = input;
  const candidate: ReviewHandoffSection[] = [
    {
      title: '审阅反馈',
      body: [
        `- 作者：${comment.author}`,
        `- 时间：${formatTime(comment.createdAt)}`,
        '- 评论原文：',
        truncateText(comment.body, COMMENT_BODY_LIMIT),
      ].join('\n'),
    },
    {
      title: '分享版本',
      body: [
        `- 标签：${snapshot.label ?? '无标签'}`,
        `- 快照时间：${formatTime(snapshot.createdAt)}`,
        `- 入口文件：${snapshot.entryPath}`,
        '- 旧分享仍显示此版本，不会因本次修改变化。',
      ].join('\n'),
    },
    { title: '快照中的目标元素', body: snapshotTargetBody(comment, snapshotSource) },
    { title: '当前版本定位', body: currentTargetBody(comment, currentSource, currentDocPath) },
    {
      title: '任务指令',
      body: `请根据以上审阅反馈修改当前页面 ${currentDocPath ?? '（未知路径）'}。保持与反馈无关的内容不变。`,
    },
  ];

  // 空 section 整省（对齐 agent-context；本卡五段恒有内容，保持防御）。
  const sections = candidate.filter(section => section.body.trim().length > 0);
  const prompt = sections.map(section => `## ${section.title}\n${section.body}`).join('\n\n');
  return { sections, prompt };
}
