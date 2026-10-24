/**
 * P4.5 生成与续改反馈——纯函数部分（设计文档 §6.1）。
 *
 * diffDesignWatchState 对比运行前后两次磁盘快照（文件清单 + 打开页修订），
 * 得出新增 HTML 文件与修订变化的打开页；agentRunStatusText 给出中文状态文案。
 * 纯函数、无 IO；run 结束监视由本文件末尾的 useAgentRunFeedback（L18）接线，
 * 横幅渲染由 L19 在 DesignPanel 内完成。
 */
import { useEffect, useRef, useState } from 'react';
import { useChatMessageStore } from '../../stores/chatMessageStore';
import { useRunStore } from '../../stores/runStore';
import { createDesignSnapshot, getDesignDocument, listDesignFiles } from './api';

export interface DesignWatchState {
  /** 已知 HTML 文件清单（工作区相对路径）。 */
  files: string[];
  /** 面板最后已知磁盘修订。 */
  openPages: { path: string; docRevision: string }[];
}

export interface AgentRunDiff {
  /** 磁盘新增 HTML（after.files − before.files，保持 after 顺序）。 */
  addedFiles: string[];
  /** 打开页磁盘修订 ≠ 面板已知（只比对双方都有的路径；before 无该页不算）。 */
  changedPages: string[];
}

export function diffDesignWatchState(before: DesignWatchState, after: DesignWatchState): AgentRunDiff {
  const knownFiles = new Set(before.files);
  const addedFiles = after.files.filter(path => !knownFiles.has(path));

  const beforeRevisions = new Map(before.openPages.map(page => [page.path, page.docRevision]));
  const changedPages = after.openPages
    .filter(page => {
      const known = beforeRevisions.get(page.path);
      return known !== undefined && known !== page.docRevision;
    })
    .map(page => page.path);

  return { addedFiles, changedPages };
}

/** runErrored=true 时在文案后追加「运行报告了错误，详情见聊天。」 */
export function agentRunStatusText(diff: AgentRunDiff, runErrored: boolean): string {
  const changedCount = new Set([...diff.addedFiles, ...diff.changedPages]).size;
  const base =
    changedCount > 0
      ? `Agent wrote ${changedCount} files`
      : 'Agent run finished; no design file changes detected';
  return runErrored ? `${base}. The run reported errors — see the chat for details.` : base;
}

// ---------------------------------------------------------------------------
// P4 §6.2 run 结束监视 hook（L18）
// ---------------------------------------------------------------------------

/** run 结束后的防抖等待时长：等聊天错误标记与磁盘写入落定。 */
const RUN_SETTLE_DEBOUNCE_MS = 500;

/** 恢复点标签：`Agent MM-dd HH:mm`（本地时间，一次评估共用同一时刻）。 */
function agentSnapshotLabel(date: Date): string {
  const two = (value: number) => String(value).padStart(2, '0');
  return `Agent ${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

export interface AgentRunFeedbackOptions {
  sessionId: string;
  backendId: string;
  enabled: boolean;
  /** 面板提供当前已知状态（files + controller 打开页的磁盘修订）。 */
  getWatchState: () => DesignWatchState;
  /** 触发面板常规刷新（驱动控制器接管新磁盘状态）。 */
  refreshNow: () => void;
}

export interface AgentRunFeedbackStatus {
  text: string;
  diff: AgentRunDiff;
}

interface PendingEvaluation {
  sessionId: string;
  before: DesignWatchState;
  runErrored: boolean;
}

/**
 * run 结束时读最后一条 assistant 消息：content 含 `**Error:**` → true。
 * 消息缺失 / 无标记 / 结构异常一律按 false 容错（§6.2 best-effort 口径）。
 */
function readRunErrored(sessionId: string): boolean {
  try {
    const messages = useChatMessageStore.getState().messages[sessionId];
    if (!Array.isArray(messages)) return false;
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index] as { role?: unknown; content?: unknown } | undefined;
      if (!message || message.role !== 'assistant') continue;
      return typeof message.content === 'string' && message.content.includes('**Error:**');
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * run 结束监视（P4 §6.2）：订阅 useRunStore，观察到本会话 runId「非空 → 空」
 * 且 enabled 时捕获 before（getWatchState + 错误标记），防抖 500 ms 后自取
 * after（listDesignFiles 过滤 HTML + 逐打开页 getDesignDocument，单页失败静默
 * 跳过；清单失败则整轮放弃），diff 后触发 refreshNow 并对 changedPages 逐页
 * 创建恢复点快照（allSettled，任一失败在文案后追加「（恢复点创建失败）」）。
 * 过渡时 enabled=false 的那次不补触发；sessionId 切换清 status 与计时器；
 * 卸载清理订阅与计时器。只读订阅，不改 runStore / chatMessageStore。
 */
export function useAgentRunFeedback(options: AgentRunFeedbackOptions): {
  status: AgentRunFeedbackStatus | null;
  dismiss: () => void;
} {
  const { sessionId } = options;
  const [status, setStatus] = useState<AgentRunFeedbackStatus | null>(null);
  // sessionId 切换的 status 清零走「渲染期调整」（避免 effect 内 setState 级联）。
  const [prevSessionId, setPrevSessionId] = useState(sessionId);
  if (prevSessionId !== sessionId) {
    setPrevSessionId(sessionId);
    setStatus(null);
  }
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRunIdRef = useRef<string | null>(null);
  const pendingRef = useRef<PendingEvaluation | null>(null);

  // 最新 options 经 ref 读取：订阅只建立一次，enabled/回调变化不重挂。
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => {
    const evaluate = async (pending: PendingEvaluation) => {
      const current = optionsRef.current;
      let files: string[];
      try {
        const result = await listDesignFiles(current.backendId, current.sessionId);
        const raw = Array.isArray(result?.files) ? result.files : [];
        files = raw.filter((path): path is string => typeof path === 'string' && /\.html?$/i.test(path));
      } catch {
        // 清单拉取失败：整轮放弃，保持初始等待态（不写 status）。
        return;
      }

      const openPages: { path: string; docRevision: string }[] = [];
      for (const page of pending.before.openPages) {
        if (typeof page?.path !== 'string') continue;
        try {
          const doc = await getDesignDocument(current.backendId, current.sessionId, page.path);
          if (doc && typeof doc.revision === 'string') {
            openPages.push({ path: page.path, docRevision: doc.revision });
          }
        } catch {
          // 单页修订获取失败：静默跳过该页（该页不计入 changedPages）。
        }
      }

      const diff = diffDesignWatchState(pending.before, { files, openPages });
      if (optionsRef.current.sessionId === pending.sessionId) optionsRef.current.refreshNow();

      let suffix = '';
      if (diff.changedPages.length > 0) {
        const label = agentSnapshotLabel(new Date());
        const results = await Promise.allSettled(
          diff.changedPages.map(path =>
            createDesignSnapshot(current.backendId, {
              sessionId: current.sessionId,
              path,
              label,
              source: 'manual',
            })
          )
        );
        if (results.some(result => result.status === 'rejected'))
          suffix = ' (restore point creation failed)';
      }

      // 评估期间切了会话：结果作废，不写 status。
      if (optionsRef.current.sessionId !== pending.sessionId) return;
      setStatus({ text: `${agentRunStatusText(diff, pending.runErrored)}${suffix}`, diff });
    };

    const clearTimer = () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const unsubscribe = useRunStore.subscribe(() => {
      const current = optionsRef.current;
      const runId = useRunStore.getState().getSessionRunId(current.sessionId);
      const previous = lastRunIdRef.current;
      lastRunIdRef.current = runId;
      if (previous === null || runId !== null) return; // 只关心「非空 → 空」
      if (!current.enabled) return; // 过渡时未启用：忽略本次，不补触发
      // 捕获 before 与错误标记后防抖；新的过渡到来会重置计时器与捕获值。
      pendingRef.current = {
        sessionId: current.sessionId,
        before: current.getWatchState(),
        runErrored: readRunErrored(current.sessionId),
      };
      clearTimer();
      const pending = pendingRef.current;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void evaluate(pending);
      }, RUN_SETTLE_DEBOUNCE_MS);
    });

    return () => {
      unsubscribe();
      clearTimer();
    };
  }, []);

  // sessionId 切换：清计时器并重置新会话的 runId 基线（status 已在渲染期清零）。
  useEffect(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    lastRunIdRef.current = useRunStore.getState().getSessionRunId(sessionId);
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [sessionId]);

  const dismiss = () => setStatus(null);

  return { status, dismiss };
}
