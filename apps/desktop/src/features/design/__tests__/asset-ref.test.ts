import { describe, expect, it } from 'vitest';
import { relativeAssetRef } from '../asset-ref';

describe('relativeAssetRef（P3 §5.2 客户端资产引用换算）', () => {
  it('子目录资产向上回退一级', () => {
    expect(relativeAssetRef('design/index.html', 'assets/a.png')).toBe('../assets/a.png');
  });

  it('同目录资产直接引用文件名', () => {
    expect(relativeAssetRef('design/index.html', 'design/a.png')).toBe('a.png');
  });

  it('doc 位于根目录时子目录资产直接引用', () => {
    expect(relativeAssetRef('index.html', 'assets/a.png')).toBe('assets/a.png');
  });

  it('根级资产从子目录文档向上回退', () => {
    expect(relativeAssetRef('design/index.html', 'a.png')).toBe('../a.png');
  });

  it('多级回退按目录深度补足 ../', () => {
    expect(relativeAssetRef('a/b/page.html', 'x/y/z.png')).toBe('../../x/y/z.png');
  });

  it('部分公共前缀只回退差异段', () => {
    expect(relativeAssetRef('a/b/page.html', 'a/c/d.png')).toBe('../c/d.png');
  });

  it('doc 同目录的深层子目录资产去掉公共前缀', () => {
    expect(relativeAssetRef('design/index.html', 'design/assets/img.png')).toBe('assets/img.png');
  });

  it('根级文档引用根级资产', () => {
    expect(relativeAssetRef('index.html', 'logo.png')).toBe('logo.png');
  });

  it('不做 URL 编码：空格与中文原样保留', () => {
    expect(relativeAssetRef('design/index.html', 'assets/图片 a.png')).toBe('../assets/图片 a.png');
  });
});
