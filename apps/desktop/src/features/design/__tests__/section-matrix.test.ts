import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SECTION_OPEN,
  INSPECTOR_SECTION_ORDER,
  VOID_TAGS,
  isSectionVisible,
  type InspectorSectionId,
} from '../inspector/section-matrix';

const REQUIRED_VOID_TAGS = [
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
];

/** 标签 × 分区的期望可见性表（text/link/image/typography/fill-border/size-spacing/structure）。 */
const VISIBILITY_TABLE: Record<string, Record<InspectorSectionId, boolean>> = {
  h1: {
    text: true,
    link: false,
    image: false,
    typography: true,
    'fill-border': true,
    'size-spacing': true,
    structure: true,
  },
  p: {
    text: true,
    link: false,
    image: false,
    typography: true,
    'fill-border': true,
    'size-spacing': true,
    structure: true,
  },
  a: {
    text: true,
    link: true,
    image: false,
    typography: true,
    'fill-border': true,
    'size-spacing': true,
    structure: true,
  },
  img: {
    text: false,
    link: false,
    image: true,
    typography: false,
    'fill-border': true,
    'size-spacing': true,
    structure: true,
  },
  div: {
    text: true,
    link: false,
    image: false,
    typography: true,
    'fill-border': true,
    'size-spacing': true,
    structure: true,
  },
  button: {
    text: true,
    link: false,
    image: false,
    typography: true,
    'fill-border': true,
    'size-spacing': true,
    structure: true,
  },
  br: {
    text: false,
    link: false,
    image: false,
    typography: true,
    'fill-border': true,
    'size-spacing': true,
    structure: true,
  },
  input: {
    text: false,
    link: false,
    image: false,
    typography: true,
    'fill-border': true,
    'size-spacing': true,
    structure: true,
  },
};

describe('inspector section-matrix（分区顺序/默认展开/标签可见性）', () => {
  it('INSPECTOR_SECTION_ORDER：text → link → image → typography → fill-border → size-spacing → structure', () => {
    expect([...INSPECTOR_SECTION_ORDER]).toEqual([
      'text',
      'link',
      'image',
      'typography',
      'fill-border',
      'size-spacing',
      'structure',
    ]);
  });

  it('DEFAULT_SECTION_OPEN：text/link/image/typography 默认展开，其余折叠', () => {
    expect(DEFAULT_SECTION_OPEN).toEqual({
      text: true,
      link: true,
      image: true,
      typography: true,
      'fill-border': false,
      'size-spacing': false,
      structure: false,
    });
  });

  it('VOID_TAGS：至少包含 HTML 全部 void 标签', () => {
    for (const tag of REQUIRED_VOID_TAGS) {
      expect(VOID_TAGS.has(tag), tag).toBe(true);
    }
  });

  it('isSectionVisible：h1/p/a/img/div/button/br/input × 七分区可见性表', () => {
    for (const [tag, expected] of Object.entries(VISIBILITY_TABLE)) {
      for (const id of INSPECTOR_SECTION_ORDER) {
        expect(isSectionVisible(id, tag), `${id} @ ${tag}`).toBe(expected[id]);
      }
    }
  });

  it('isSectionVisible：文字分区对 void 标签全部隐藏，对非 void 标签可见', () => {
    for (const tag of REQUIRED_VOID_TAGS) {
      expect(isSectionVisible('text', tag)).toBe(false);
    }
    expect(isSectionVisible('text', 'span')).toBe(true);
  });
});
