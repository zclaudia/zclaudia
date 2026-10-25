import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { DesignTier } from '../layout/tiers';
import { isCompactWidth, tierForWidth } from '../layout/tiers';

export interface ElementTier {
  width: number;
  height: number;
  tier: DesignTier;
  compact: boolean;
}

/**
 * 实测宿主元素内容宽度并映射为响应式档位。初值 width 0（tier 'wide'，
 * compact false）；无 ResizeObserver（如 jsdom）时保持初值不测量。
 */
export function useElementTier<T extends HTMLElement = HTMLDivElement>(): {
  ref: RefObject<T | null>;
  width: number;
  height: number;
  tier: DesignTier;
  compact: boolean;
} {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return {
    ref,
    width: size.width,
    height: size.height,
    tier: tierForWidth(size.width),
    compact: isCompactWidth(size.width),
  };
}
