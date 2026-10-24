/**
 * 共享 CSS 值比较器：P3 重选 override 核对（DesignPanel reselect 回路）与
 * P3.5「生效中」徽标（css-source winning 判定）共用同一口径。
 * 无可靠口径的组合一律返回 null（跳过），宁缺勿误报。
 */
const COLOR_KEYS = new Set(['color', 'background-color', 'border-color']);
const KEYWORD_KEYS = new Set(['text-align', 'border-style', 'object-fit']);
const LENGTH_KEYS = new Set([
  'width',
  'height',
  'font-size',
  'line-height',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-width',
  'border-radius',
]);
const PX_LENGTH = /^[+-]?[\d.]+px$/;

/** font-weight 归一到 100–900 数值；bold→700、normal→400，bolder/lighter 与范围外值返回 null（跳过）。 */
export function fontWeightValue(value: string): number | null {
  const keyword = value.trim().toLowerCase();
  if (keyword === 'bold') return 700;
  if (keyword === 'normal') return 400;
  if (keyword === 'bolder' || keyword === 'lighter') return null;
  if (/^\d+$/.test(keyword)) {
    const numeric = Number(keyword);
    return numeric >= 100 && numeric <= 900 ? numeric : null;
  }
  return null;
}

/** 按浏览器自身序列化器口径比较两种 CSS 颜色写法。 */
export function colorsEquivalent(written: string, computed: string): boolean {
  const a = written.trim();
  const b = computed.trim();
  if (a.toLowerCase() === b.toLowerCase()) return true;
  const probe = document.createElement('span');
  probe.style.color = a;
  const normalized = probe.style.color;
  return (
    !!normalized &&
    normalized.replace(/\s+/g, '').toLowerCase() === b.replace(/\s+/g, '').toLowerCase()
  );
}

/**
 * 比较写入口径与计算值：true = 相等，false = 失配，null = 无可靠口径跳过
 * （font-family、margin/padding 简写、非纯 px 写法的长度、bolder/lighter 等）。
 */
export function compareCssValues(property: string, written: string, computed: string): boolean | null {
  if (COLOR_KEYS.has(property)) return colorsEquivalent(written, computed);
  if (property === 'font-weight') {
    const expectedWeight = fontWeightValue(written);
    const computedWeight = fontWeightValue(computed);
    return expectedWeight !== null && computedWeight !== null
      ? expectedWeight === computedWeight
      : null;
  }
  if (KEYWORD_KEYS.has(property)) {
    return written.trim().toLowerCase() === computed.trim().toLowerCase();
  }
  if (LENGTH_KEYS.has(property)) {
    // 长度键仅当双方都是纯 px 写法时按数值比对（em/%/简写不可靠）。
    if (PX_LENGTH.test(written) && PX_LENGTH.test(computed)) {
      return Number.parseFloat(written) === Number.parseFloat(computed);
    }
    return null;
  }
  return null;
}
