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
  return (reason && LOCATOR_REASON_TEXT[reason as keyof typeof LOCATOR_REASON_TEXT]) || 'Unknown reason';
}

/** 「快照中的目标元素」段：快照源码 / 整页评论 / 命中切片 / 罕见失效如实写原因。 */
function snapshotTargetBody(comment: DesignShareComment, snapshotSource: string | null): string {
  if (snapshotSource === null) return 'Snapshot source unavailable.';
  if (comment.target === null) return 'Whole-page comment (not anchored to a specific element).';
  const match = matchCommentTarget(snapshotSource, comment.target);
  if (!match.matched) {
    return `Could not locate the target element in the snapshot source (${reasonText(match.reason)}).`;
  }
  const lines = [`- Element: <${comment.target.tagName}>`];
  if (match.text !== undefined) lines.push(`- Collapsed text: ${match.text}`);
  if (match.snippet !== undefined) lines.push('- Snapshot source snippet:', match.snippet);
  return lines.join('\n');
}

/** 「当前版本定位」段：命中给路径 + 切片；失效给逐字文案并要求自证定位。 */
function currentTargetBody(
  comment: DesignShareComment,
  currentSource: string | null,
  currentDocPath: string | null
): string {
  if (currentSource === null) return 'Current source unavailable.';
  const path = currentDocPath ?? '(unknown path)';
  if (comment.target === null) {
    return [`- Page: ${path}`, 'Whole-page comment (not anchored to a specific element).'].join('\n');
  }
  const match = matchCommentTarget(currentSource, comment.target);
  if (!match.matched) {
    return (
      `The element anchor is no longer valid (${reasonText(match.reason)}). ` +
      'Locate the target element yourself using the comment description and the shared version, and state which element you located in your reply before making changes.'
    );
  }
  const lines = [`- Page: ${path}`, `- Element: <${comment.target.tagName}>`];
  if (match.text !== undefined) lines.push(`- Collapsed text: ${match.text}`);
  if (match.snippet !== undefined) lines.push('- Current source snippet:', match.snippet);
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
      title: 'Review feedback',
      body: [
        `- Author: ${comment.author}`,
        `- Time: ${formatTime(comment.createdAt)}`,
        '- Comment:',
        truncateText(comment.body, COMMENT_BODY_LIMIT),
      ].join('\n'),
    },
    {
      title: 'Shared version',
      body: [
        `- Label: ${snapshot.label ?? 'No label'}`,
        `- Snapshot time: ${formatTime(snapshot.createdAt)}`,
        `- Entry file: ${snapshot.entryPath}`,
        '- Existing shares still show this version; they will not change with this edit.',
      ].join('\n'),
    },
    { title: 'Target element in the snapshot', body: snapshotTargetBody(comment, snapshotSource) },
    { title: 'Location in the current version', body: currentTargetBody(comment, currentSource, currentDocPath) },
    {
      title: 'Instruction',
      body: `Please update the current page ${currentDocPath ?? '(unknown path)'} based on the review feedback above. Keep everything unrelated to the feedback unchanged.`,
    },
  ];

  // 空 section 整省（对齐 agent-context；本卡五段恒有内容，保持防御）。
  const sections = candidate.filter(section => section.body.trim().length > 0);
  const prompt = sections.map(section => `## ${section.title}\n${section.body}`).join('\n\n');
  return { sections, prompt };
}
