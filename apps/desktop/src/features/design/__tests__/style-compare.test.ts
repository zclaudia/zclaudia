import { describe, expect, it } from 'vitest';
import { colorsEquivalent, compareCssValues, fontWeightValue } from '../html/style-compare';

describe('style-compare（P3.5 T0：自 DesignPanel 抽出的共享比较器）', () => {
  it('colorsEquivalent：同色不同写法等价，异色不等', () => {
    expect(colorsEquivalent('#ff0000', 'rgb(255, 0, 0)')).toBe(true);
    expect(colorsEquivalent('#FF0000', '#ff0000')).toBe(true);
    expect(colorsEquivalent('#ff0000', '#00ff00')).toBe(false);
  });

  it('fontWeightValue：bold→700、normal→400、数字透传（100–900），bolder/lighter 与范围外为 null', () => {
    expect(fontWeightValue('bold')).toBe(700);
    expect(fontWeightValue('normal')).toBe(400);
    expect(fontWeightValue('600')).toBe(600);
    expect(fontWeightValue('bolder')).toBeNull();
    expect(fontWeightValue('950')).toBeNull();
  });

  it('compareCssValues 三态：相等/失配/无口径跳过', () => {
    expect(compareCssValues('color', '#f00', 'rgb(255,0,0)')).toBe(true);
    expect(compareCssValues('font-weight', 'bold', '700')).toBe(true);
    expect(compareCssValues('font-weight', 'bold', '400')).toBe(false);
    expect(compareCssValues('text-align', 'Center', 'center')).toBe(true);
    expect(compareCssValues('text-align', 'left', 'center')).toBe(false);
    expect(compareCssValues('width', '100px', '100px')).toBe(true);
    expect(compareCssValues('width', '100px', '50px')).toBe(false);
    // 无可靠口径：em/百分比长度、font-family、margin 简写 → null（跳过）。
    expect(compareCssValues('width', '10em', '160px')).toBeNull();
    expect(compareCssValues('font-family', 'serif', 'serif')).toBeNull();
    expect(compareCssValues('font-weight', 'bolder', '700')).toBeNull();
  });
});
