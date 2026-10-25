import { useCallback, useEffect, useRef, useState } from 'react';

/** 面板内通知的语义色（Tone 的子集：通知只需要这三种）。 */
export type NoticeTone = 'neutral' | 'warning' | 'destructive';

export interface DesignNoticeAction {
  label: string;
  onSelect: () => void;
}

export interface DesignNotice {
  id: string;
  /** 缺省按 'neutral' 渲染。 */
  tone?: NoticeTone;
  text: string;
  actions?: DesignNoticeAction[];
  /** 自动消失的毫秒数；undefined = 常驻，须手动关闭。 */
  ttl?: number;
}

export interface UseDesignNoticesResult {
  notices: DesignNotice[];
  /** 同 id 再推入 = 原位替换并重启 ttl 计时。 */
  push: (notice: DesignNotice) => void;
  dismiss: (id: string) => void;
}

/**
 * 面板内通知栈模型：按插入序保存，ttl 用 window.setTimeout 定时消失；
 * 同 id 再推入先清旧计时再重启；dismiss 即时清计时；卸载清空全部计时器，
 * 不泄漏。计时句柄放 ref（setState 之外），回调经 useCallback 保持稳定。
 */
export function useDesignNotices(): UseDesignNoticesResult {
  const [notices, setNotices] = useState<DesignNotice[]>([]);
  /** id -> 定时器句柄；push/dismiss/卸载三处都要清理。 */
  const timersRef = useRef(new Map<string, ReturnType<typeof window.setTimeout>>());

  const clearTimer = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const dismiss = useCallback(
    (id: string) => {
      clearTimer(id);
      setNotices(prev => prev.filter(notice => notice.id !== id));
    },
    [clearTimer]
  );

  const push = useCallback(
    (notice: DesignNotice) => {
      clearTimer(notice.id);
      setNotices(prev =>
        prev.some(existing => existing.id === notice.id)
          ? prev.map(existing => (existing.id === notice.id ? notice : existing))
          : [...prev, notice]
      );
      if (notice.ttl !== undefined) {
        timersRef.current.set(
          notice.id,
          window.setTimeout(() => dismiss(notice.id), notice.ttl)
        );
      }
    },
    [clearTimer, dismiss]
  );

  // 卸载：清掉所有尚未触发的 ttl 计时器。
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, []);

  return { notices, push, dismiss };
}
