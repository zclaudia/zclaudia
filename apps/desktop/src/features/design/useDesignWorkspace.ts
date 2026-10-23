import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useWorkspaceVisible } from '../../components/workspace/WorkspaceContext';
import { useIsMounted } from '../../hooks/useIsMounted';
import { useChatMessageStore } from '../../stores/chatMessageStore';
import { getDesignDeps, getDesignDocument, listDesignFiles } from './api';
import { acquireWorkspaceController } from './workspace/controller';
import type { DesignWorkspaceController, DesignWorkspaceSnapshot } from './workspace/controller';
import type { ControllerLease } from './workspace/controller';
import { createWorkspacePorts } from './workspace/api-adapter';

const POLL_MS = 2000;
const CHAT_DEBOUNCE_MS = 400;

export interface UseDesignWorkspaceOptions {
  sessionId: string;
  backendId: string;
  projectId?: string;
  workingDirectory?: string;
}

export interface UseDesignWorkspaceResult {
  /** 引用稳定的控制器快照（useSyncExternalStore 订阅）。 */
  state: DesignWorkspaceSnapshot;
  /** 最近一次文件清单轮询得到的 HTML 文件列表。 */
  files: string[];
  /** 立即执行一轮「清单 + 活动页文档 + 活动页依赖」刷新。 */
  refreshNow: () => void;
  controller: DesignWorkspaceController;
}

/** 消息指纹：条数 + 末条 id（外部 agent 写入 file_change effect 落库后触发刷新）。 */
function chatFingerprint(messages: ReturnType<typeof useChatMessageStore.getState>['messages'][string]) {
  if (!messages || messages.length === 0) return '0:';
  return `${messages.length}:${messages[messages.length - 1]?.id ?? ''}`;
}

/**
 * 面板级工作台接线（P2 §4.2）：acquire 控制器租约 + 订阅快照 + 可见门控轮询
 * （文件清单 / 活动页文档 / 活动页依赖）+ chatMessageStore 指纹订阅。租约在
 * 卸载时 release（绝不 dispose——草稿跨面板开关存活到应用退出）。
 */
export function useDesignWorkspace({
  sessionId,
  backendId,
  projectId,
  workingDirectory,
}: UseDesignWorkspaceOptions): UseDesignWorkspaceResult {
  const visible = useWorkspaceVisible();
  const isMounted = useIsMounted();

  // 控制器租约：同一工作区 identity 复用同一实例（refcount），卸载仅 release。
  const leaseRef = useRef<ControllerLease | null>(null);
  if (!leaseRef.current) {
    leaseRef.current = acquireWorkspaceController(
      { backendId, projectId, workingDirectory },
      sessionId,
      id => createWorkspacePorts(backendId, id)
    );
  }
  const controller = leaseRef.current.controller;

  useEffect(() => {
    const lease = leaseRef.current;
    controller.rebind(sessionId);
    return () => {
      lease?.release();
      leaseRef.current = null;
    };
  }, [controller, sessionId]);

  const subscribe = useCallback(
    (listener: () => void) => controller.subscribe(listener),
    [controller]
  );
  const getSnapshot = useCallback(() => controller.getSnapshot(), [controller]);
  const state = useSyncExternalStore(subscribe, getSnapshot);

  const [files, setFiles] = useState<string[]>([]);
  const requestRef = useRef(0);
  // 初始化为当前时间：挂载首轮由可见性 effect 发起，激活补查不得重复触发。
  const lastPollAtRef = useRef(Date.now());
  const timerRef = useRef<number | undefined>(undefined);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  /**
   * 一轮完整刷新（P2 §4.2）：文件清单 → refreshFiles；活动页（非 loading）
   * 文档轮询 → handleExternalDoc、依赖轮询 → applyDepsStats。三者同 tick 顺序
   * 发起，全部带请求序号防串；无打开页时沿用发现逻辑恢复/打开初始页。
   */
  const runPollRound = useCallback(async () => {
    const request = ++requestRef.current;
    lastPollAtRef.current = Date.now();
    let htmlFiles: string[] | null = null;
    try {
      const result = await listDesignFiles(backendId, sessionId);
      if (!isMounted() || request !== requestRef.current) return;
      htmlFiles = result.files.filter(
        path => typeof path === 'string' && /\.html?$/i.test(path)
      );
      setFiles(htmlFiles);
      controller.refreshFiles(htmlFiles);
    } catch {
      // 轮询失败静默：下一轮重试（页面级错误由控制器自己写页 error）。
    }

    const snapshot = controller.getSnapshot();
    if (snapshot.pages.length === 0 && htmlFiles && htmlFiles.length > 0) {
      // 空态发现：storage.activePath 优先（且在清单中），其次 design/index.html，
      // 再次第一个文件；生成流程的新文件到达同样由此打开。
      const stored = snapshot.ui.activePath;
      const candidate =
        stored && htmlFiles.includes(stored)
          ? stored
          : htmlFiles.includes('design/index.html')
            ? 'design/index.html'
            : htmlFiles[0];
      void controller.open(candidate);
    }

    const active = snapshot.pages.find(page => page.path === snapshot.activePath);
    if (!active || active.status === 'loading') return;
    try {
      const doc = await getDesignDocument(backendId, sessionId, active.path);
      if (!isMounted() || request !== requestRef.current) return;
      await controller.handleExternalDoc(doc);
    } catch {
      // 同上：静默重试。
    }
    try {
      const deps = await getDesignDeps(backendId, sessionId, active.path);
      if (!isMounted() || request !== requestRef.current) return;
      controller.applyDepsStats(deps);
    } catch {
      // 依赖 stat 拉取失败不影响文档状态。
    }
  }, [backendId, controller, isMounted, sessionId]);

  const refreshNow = useCallback(() => {
    void runPollRound();
  }, [runPollRound]);

  // 可见门控轮询：可见时立即一轮，随后每 POLL_MS 一轮；隐藏/卸载即停。
  useEffect(() => {
    if (!visible) return;
    void runPollRound();
    const schedule = () => {
      timerRef.current = window.setTimeout(() => {
        void runPollRound();
        schedule();
      }, POLL_MS);
    };
    schedule();
    return () => {
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
    };
  }, [visible, runPollRound]);

  // 激活另一页时若距上次检查超过一个轮询周期，立即补一次检查（P2 §4.2）。
  useEffect(() => {
    if (!visible) return;
    if (Date.now() - lastPollAtRef.current <= POLL_MS) return;
    void runPollRound();
  }, [visible, state.activePath, runPollRound]);

  // chatMessageStore 指纹订阅：外部写入落库 → 400ms 去抖触发一轮立即刷新。
  useEffect(() => {
    let last = chatFingerprint(useChatMessageStore.getState().messages[sessionId]);
    let debounce: number | undefined;
    const unsubscribe = useChatMessageStore.subscribe(snapshot => {
      const next = chatFingerprint(snapshot.messages[sessionId]);
      if (next === last) return;
      last = next;
      if (!visibleRef.current) return;
      if (debounce !== undefined) window.clearTimeout(debounce);
      debounce = window.setTimeout(() => {
        debounce = undefined;
        void runPollRound();
      }, CHAT_DEBOUNCE_MS);
    });
    return () => {
      unsubscribe();
      if (debounce !== undefined) window.clearTimeout(debounce);
    };
  }, [sessionId, runPollRound]);

  return { state, files, refreshNow, controller };
}
