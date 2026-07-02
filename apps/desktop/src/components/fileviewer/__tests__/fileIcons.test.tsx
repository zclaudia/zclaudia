import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { FileTypeIcon, iconForFileName } from '../fileIcons';
import { File, FileCode, FileJson, FileText, Image, Settings2 } from 'lucide-react';

describe('iconForFileName', () => {
  it.each([
    ['index.ts', FileCode],
    ['App.tsx', FileCode],
    ['build.rs', FileCode],
    ['deploy.sh', FileCode],
    ['Dockerfile', FileCode],
    ['README.md', FileText],
    ['LICENSE', FileText],
    ['notes.txt', FileText],
    ['package.json', FileJson],
    ['config.yaml', FileJson],
    ['Cargo.toml', FileJson],
    ['pnpm-lock.yaml', FileJson],
    ['logo.svg', Image],
    ['photo.PNG', Image],
    ['.gitignore', Settings2],
    ['.env.local', Settings2],
    ['.prettierrc.json', Settings2],
    ['vite.config.ts', Settings2],
    ['unknown.xyz', File],
    ['no-extension', File],
  ])('%s → expected lucide icon', (name, expected) => {
    expect(iconForFileName(name)).toBe(expected);
  });
});

describe('FileTypeIcon', () => {
  it('renders a monochrome lucide svg, no raw-color svg markup', () => {
    const { container } = render(<FileTypeIcon name="index.ts" className="wrapper" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('stroke')).toBe('currentColor');
    expect(svg!.getAttribute('stroke-width')).toBe('1.75');
    expect(container.querySelector('[fill]:not([fill="none"])')).toBeNull();
  });

  it('keeps the wrapper span + className contract', () => {
    const { container } = render(<FileTypeIcon name="a.md" className="wrapper" />);
    const span = container.querySelector('span.wrapper');
    expect(span).not.toBeNull();
    expect(span!.getAttribute('aria-hidden')).toBe('true');
  });
});
