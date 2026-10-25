import { useCallback, useEffect, useRef, useState } from 'react';
import type { DesignWorkspaceController } from '../workspace/controller';
import { isValidRulesMessage, isValidSelection, pathsEqual, reselectMismatch } from '../validators';
import { colorsEquivalent } from '../html/style-compare';
import type { DesignRulesMessage } from '../types';

/** 运行桥接 navigate 的 path 校验上限（P5 §2.4）。 */
const RUN_NAV_PATH_MAX = 500;
/** scheme 形态引用（运行 navigate path 与外部链接同口径）。 */
const SCHEME_LIKE = /^[a-z][a-z\d+.-]*:/i;

/** 运行模式导航提示（design-navigate / design-nav-blocked），5 秒自动消失或手动关闭。 */
export interface RunNotice {
  text: string;
}

export interface VerifyExpectation {
  elementPath: number[];
  expected: { color?: string; backgroundColor?: string };
}

/** 应用后重选（§6.1/§6.3）：本轮写入的属性期望值，等 iframe 回发 select 消息时核对。 */
export interface ReselectExpectation {
  elementPath: number[];
  /** 属性名 → 写入值（仅 value 非 null 的 style 操作；键与 select 消息 styles 一致）。 */
  expected: Map<string, string>;
}

/** C0 控制字符与 DEL（码点比较，规避 no-control-regex；对齐 deck.ts）。 */
function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export interface UsePreviewBridgeOptions {
  channel: string;
  controller: DesignWorkspaceController;
  previewMode: 'edit' | 'run';
  /** 工作区全部 HTML 文件（运行模式 navigate 的合法性判定）。 */
  files: string[];
}

export interface UsePreviewBridgeResult {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  verifyRef: React.MutableRefObject<VerifyExpectation | null>;
  reselectRef: React.MutableRefObject<ReselectExpectation | null>;
  overrideWarning: boolean;
  runNotice: RunNotice | null;
  dismissRunNotice: () => void;
  clearRunNotice: () => void;
  /** 校验通过的生效规则载荷；样式来源区按当前选区即时对齐渲染。 */
  styleRules: DesignRulesMessage | null;
  /** 切页时清空规则载荷（旧页规则不污染新选区）。 */
  clearStyleRules: () => void;
  /** 元素导航（树节点 / 父级 / 子级）：向预览桥接发送路径选择请求（§6.1）。 */
  selectPath: (path: number[]) => void;
  /** iframe load 回调：补发 verify / post-apply reselect（每个帧载入至多一次）。 */
  handleFrameLoad: () => void;
}

/**
 * 预览桥接消息接线（P0 拆分自 DesignPanel）：select / rules / verify /
 * navigate 消息的校验与落地，以及应用后期望值的 ref。消息只处理来自
 * 本面板 iframe 且 channel 匹配的事件；迟到/错位载荷静默丢弃。
 */
export function usePreviewBridge({
  channel,
  controller,
  previewMode,
  files,
}: UsePreviewBridgeOptions): UsePreviewBridgeResult {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const verifyRef = useRef<VerifyExpectation | null>(null);
  const reselectRef = useRef<ReselectExpectation | null>(null);
  const [overrideWarning, setOverrideWarning] = useState(false);
  const [runNotice, setRunNotice] = useState<RunNotice | null>(null);
  const [styleRules, setStyleRules] = useState<DesignRulesMessage | null>(null);
  // files 经 ref 每渲染同步，避免闭包过期（P4.5 run 反馈与 P5 navigate 消息共用）。
  const filesRef = useRef(files);
  filesRef.current = files;

  useEffect(() => {
    const handle = (event: MessageEvent) => {
      const frame = iframeRef.current;
      if (!frame?.contentWindow || event.source !== frame.contentWindow) return;
      const data = event.data as {
        type?: string;
        channel?: string;
        selection?: unknown;
        elementPath?: unknown;
        color?: unknown;
        backgroundColor?: unknown;
        path?: unknown;
        reason?: unknown;
        rules?: unknown;
        truncated?: unknown;
      } | null;
      if (!data || data.channel !== channel) return;
      // P5 运行模式导航（§2.4）：仅运行预览的桥接会发这两类消息，编辑模式不响应。
      if (previewMode === 'run' && data.type === 'zclaudia:design-navigate') {
        const raw = typeof data.path === 'string' ? data.path : '';
        const valid =
          raw.length > 0 &&
          raw.length <= RUN_NAV_PATH_MAX &&
          !raw.includes('\\') &&
          !hasControlChars(raw) &&
          !SCHEME_LIKE.test(raw);
        if (valid && filesRef.current.includes(raw)) {
          setRunNotice({ text: `Opened ${raw}` });
          void controller.open(raw);
        } else {
          setRunNotice({ text: `Target page is not in the workspace: ${raw}` });
        }
        return;
      }
      if (previewMode === 'run' && data.type === 'zclaudia:design-nav-blocked') {
        setRunNotice({
          text:
            data.reason === 'external'
              ? 'Blocked opening an external link'
              : 'Blocked a non-page link (only in-workspace HTML navigation is supported)',
        });
        return;
      }
      if (data.type === 'zclaudia:design-select') {
        if (!isValidSelection(data.selection)) return;
        verifyRef.current = null;
        setOverrideWarning(false);
        const reselect = reselectRef.current;
        if (reselect) {
          if (pathsEqual(data.selection.elementPath, reselect.elementPath)) {
            // §6.3：应用后的重选到达，按对比表核对写入值与计算样式。
            if (reselectMismatch(reselect.expected, data.selection)) {
              setOverrideWarning(true);
            }
          }
          // 路径不同 = 用户已点选其他元素：本轮重选作废，不告警。
          reselectRef.current = null;
        }
        controller.handleSelectionMessage(data.selection);
        // P3.5 §2：选区落地后请求生效规则（桥内枚举 CSSOM，回发 zclaudia:design-rules 消息）。
        frame.contentWindow.postMessage(
          {
            type: 'zclaudia:design-rules-request',
            channel,
            elementPath: data.selection.elementPath,
          },
          '*'
        );
        return;
      }
      if (data.type === 'zclaudia:design-rules') {
        const path = Array.isArray(data.elementPath) ? data.elementPath : null;
        // 当前选区取控制器快照（消息闭包外最新值，不随渲染闭包过期）。
        const snapshot = controller.getSnapshot();
        const currentPath = snapshot.activePath
          ? (snapshot.pages.find(page => page.path === snapshot.activePath)?.selection
              ?.elementPath ?? null)
          : null;
        // 迟到/错位消息不污染新选区：elementPath 与当前选区不一致即静默丢弃（口径同 select 路径核对）。
        if (!path || !currentPath || !pathsEqual(path, currentPath)) return;
        const payload: unknown = {
          elementPath: path,
          rules: data.rules,
          truncated: data.truncated,
        };
        // 载荷形状/上限违规整体丢弃（§2：不告警、不清选区）。
        if (!isValidRulesMessage(payload)) return;
        setStyleRules(payload);
        return;
      }
      if (data.type === 'zclaudia:design-select-failed') {
        // 树与预览短暂不同步属正常（§6.1）：清挂起重选、不弹错，用户下次点击自愈。
        reselectRef.current = null;
        return;
      }
      if (data.type === 'zclaudia:design-verify-result') {
        const pending = verifyRef.current;
        if (!pending) return;
        if (JSON.stringify(data.elementPath ?? []) !== JSON.stringify(pending.elementPath)) return;
        verifyRef.current = null;
        let mismatch = false;
        if (typeof data.color === 'string' && pending.expected.color) {
          mismatch ||= !colorsEquivalent(pending.expected.color, data.color);
        }
        if (typeof data.backgroundColor === 'string' && pending.expected.backgroundColor) {
          mismatch ||= !colorsEquivalent(pending.expected.backgroundColor, data.backgroundColor);
        }
        if (mismatch) setOverrideWarning(true);
      }
    };
    window.addEventListener('message', handle);
    return () => window.removeEventListener('message', handle);
  }, [channel, controller, previewMode]);

  // 运行导航提示 5 秒自动消失（§2.4）；手动关闭走提示条按钮。
  useEffect(() => {
    if (!runNotice) return;
    const timer = window.setTimeout(() => setRunNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [runNotice]);

  // The verify request and the post-apply reselect must reach the rebuilt preview,
  // so both are sent on the iframe's load event (at most once per frame load).
  const handleFrameLoad = useCallback(() => {
    const frame = iframeRef.current;
    if (!frame?.contentWindow) return;
    const pending = verifyRef.current;
    if (pending) {
      frame.contentWindow.postMessage(
        { type: 'zclaudia:design-verify', channel, elementPath: pending.elementPath },
        '*'
      );
    }
    if (reselectRef.current) {
      frame.contentWindow.postMessage(
        {
          type: 'zclaudia:design-select-path',
          channel,
          elementPath: reselectRef.current.elementPath,
        },
        '*'
      );
    }
  }, [channel]);

  const selectPath = useCallback(
    (path: number[]) => {
      const frame = iframeRef.current;
      if (!frame?.contentWindow) return;
      frame.contentWindow.postMessage(
        { type: 'zclaudia:design-select-path', channel, elementPath: path },
        '*'
      );
    },
    [channel]
  );

  const dismissRunNotice = useCallback(() => setRunNotice(null), []);
  const clearStyleRules = useCallback(() => setStyleRules(null), []);

  return {
    iframeRef,
    verifyRef,
    reselectRef,
    overrideWarning,
    runNotice,
    dismissRunNotice,
    clearRunNotice: dismissRunNotice,
    styleRules,
    clearStyleRules,
    selectPath,
    handleFrameLoad,
  };
}
