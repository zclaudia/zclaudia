import { beforeEach, describe, expect, it } from 'vitest';
import {
  DESIGN_LEFT_WIDTH_MAX,
  DESIGN_LEFT_WIDTH_MIN,
  useDesignLayoutStore,
} from '../stores/designLayoutStore';

const STORAGE_KEY = 'zclaudia-design-layout-v1';

const DEFAULTS = {
  leftOpen: true,
  leftTab: 'pages',
  libraryTab: 'assets',
  leftWidth: 240,
  rightOpen: true,
  rightTab: 'design',
  collapsedSections: {},
} as const;

const PERSISTED_KEYS = [
  'collapsedSections',
  'leftOpen',
  'leftTab',
  'leftWidth',
  'libraryTab',
  'rightOpen',
  'rightTab',
].sort();

describe('designLayoutStore — 设计工作台布局偏好', () => {
  beforeEach(() => {
    localStorage.clear();
    useDesignLayoutStore.setState({ ...DEFAULTS });
  });

  it('默认值：左右面板展开、tabs 为 pages/assets/design、宽度 240、无折叠分区', () => {
    const s = useDesignLayoutStore.getState();
    expect(s.leftOpen).toBe(true);
    expect(s.leftTab).toBe('pages');
    expect(s.libraryTab).toBe('assets');
    expect(s.leftWidth).toBe(240);
    expect(s.rightOpen).toBe(true);
    expect(s.rightTab).toBe('design');
    expect(s.collapsedSections).toEqual({});
  });

  it('setLeftOpen 设置左面板开合', () => {
    useDesignLayoutStore.getState().setLeftOpen(false);
    expect(useDesignLayoutStore.getState().leftOpen).toBe(false);
    useDesignLayoutStore.getState().setLeftOpen(true);
    expect(useDesignLayoutStore.getState().leftOpen).toBe(true);
  });

  it('toggleLeft 翻转左面板开合', () => {
    const { toggleLeft } = useDesignLayoutStore.getState();
    toggleLeft();
    expect(useDesignLayoutStore.getState().leftOpen).toBe(false);
    toggleLeft();
    expect(useDesignLayoutStore.getState().leftOpen).toBe(true);
  });

  it('setLeftTab 更新左面板 tab', () => {
    const { setLeftTab } = useDesignLayoutStore.getState();
    setLeftTab('layers');
    expect(useDesignLayoutStore.getState().leftTab).toBe('layers');
    setLeftTab('library');
    expect(useDesignLayoutStore.getState().leftTab).toBe('library');
    setLeftTab('slides');
    expect(useDesignLayoutStore.getState().leftTab).toBe('slides');
    setLeftTab('pages');
    expect(useDesignLayoutStore.getState().leftTab).toBe('pages');
  });

  it('setLibraryTab 更新素材库 tab', () => {
    const { setLibraryTab } = useDesignLayoutStore.getState();
    setLibraryTab('templates');
    expect(useDesignLayoutStore.getState().libraryTab).toBe('templates');
    setLibraryTab('brand');
    expect(useDesignLayoutStore.getState().libraryTab).toBe('brand');
    setLibraryTab('media');
    expect(useDesignLayoutStore.getState().libraryTab).toBe('media');
    setLibraryTab('assets');
    expect(useDesignLayoutStore.getState().libraryTab).toBe('assets');
  });

  it('setLeftWidth 在 200..420 之间夹紧并取整', () => {
    expect(DESIGN_LEFT_WIDTH_MIN).toBe(200);
    expect(DESIGN_LEFT_WIDTH_MAX).toBe(420);
    const { setLeftWidth } = useDesignLayoutStore.getState();
    setLeftWidth(199);
    expect(useDesignLayoutStore.getState().leftWidth).toBe(200);
    setLeftWidth(421);
    expect(useDesignLayoutStore.getState().leftWidth).toBe(420);
    setLeftWidth(240.6);
    expect(useDesignLayoutStore.getState().leftWidth).toBe(241);
    setLeftWidth(312);
    expect(useDesignLayoutStore.getState().leftWidth).toBe(312);
    setLeftWidth(200);
    expect(useDesignLayoutStore.getState().leftWidth).toBe(200);
    setLeftWidth(420);
    expect(useDesignLayoutStore.getState().leftWidth).toBe(420);
  });

  it('setRightOpen 设置右面板开合', () => {
    useDesignLayoutStore.getState().setRightOpen(false);
    expect(useDesignLayoutStore.getState().rightOpen).toBe(false);
    useDesignLayoutStore.getState().setRightOpen(true);
    expect(useDesignLayoutStore.getState().rightOpen).toBe(true);
  });

  it('toggleRight 翻转右面板开合', () => {
    const { toggleRight } = useDesignLayoutStore.getState();
    toggleRight();
    expect(useDesignLayoutStore.getState().rightOpen).toBe(false);
    toggleRight();
    expect(useDesignLayoutStore.getState().rightOpen).toBe(true);
  });

  it('setRightTab 更新右面板 tab', () => {
    const { setRightTab } = useDesignLayoutStore.getState();
    setRightTab('styles');
    expect(useDesignLayoutStore.getState().rightTab).toBe('styles');
    setRightTab('history');
    expect(useDesignLayoutStore.getState().rightTab).toBe('history');
    setRightTab('design');
    expect(useDesignLayoutStore.getState().rightTab).toBe('design');
  });

  it('toggleSection 默认 false -> true，翻转两次回到 false', () => {
    const { toggleSection } = useDesignLayoutStore.getState();
    expect(useDesignLayoutStore.getState().collapsedSections['outline']).toBeFalsy();
    toggleSection('outline');
    expect(useDesignLayoutStore.getState().collapsedSections['outline']).toBe(true);
    toggleSection('outline');
    expect(useDesignLayoutStore.getState().collapsedSections['outline']).toBe(false);
  });

  it('toggleSection 各分区互不影响', () => {
    const { toggleSection } = useDesignLayoutStore.getState();
    toggleSection('layers');
    toggleSection('outline');
    toggleSection('outline');
    const sections = useDesignLayoutStore.getState().collapsedSections;
    expect(sections['layers']).toBe(true);
    expect(sections['outline']).toBe(false);
  });

  it('resetLayout 恢复全部默认值', () => {
    useDesignLayoutStore.setState({
      leftOpen: false,
      leftTab: 'slides',
      libraryTab: 'media',
      leftWidth: 420,
      rightOpen: false,
      rightTab: 'history',
      collapsedSections: { outline: true },
    });
    useDesignLayoutStore.getState().resetLayout();
    const s = useDesignLayoutStore.getState();
    expect(s.leftOpen).toBe(true);
    expect(s.leftTab).toBe('pages');
    expect(s.libraryTab).toBe('assets');
    expect(s.leftWidth).toBe(240);
    expect(s.rightOpen).toBe(true);
    expect(s.rightTab).toBe('design');
    expect(s.collapsedSections).toEqual({});
  });

  it('持久化：setState 后写入 localStorage，键为 zclaudia-design-layout-v1 且只含七个偏好键', () => {
    useDesignLayoutStore.setState({
      leftOpen: false,
      leftTab: 'slides',
      libraryTab: 'media',
      leftWidth: 312,
      rightOpen: false,
      rightTab: 'styles',
      collapsedSections: { outline: true },
    });
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as { version: number; state: Record<string, unknown> };
    expect(parsed.version).toBe(1);
    expect(parsed.state).toMatchObject({
      leftOpen: false,
      leftTab: 'slides',
      libraryTab: 'media',
      leftWidth: 312,
      rightOpen: false,
      rightTab: 'styles',
      collapsedSections: { outline: true },
    });
    expect(Object.keys(parsed.state).sort()).toEqual(PERSISTED_KEYS);
  });
});
