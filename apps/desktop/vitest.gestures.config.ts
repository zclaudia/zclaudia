/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8'));

// Navigation tests require real DOM constructors and event propagation. The
// lightweight hook setup deliberately replaces those APIs for logic tests.
export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: {
    name: 'gestures',
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup-gestures.ts'],
    include: [
      'src/app/__tests__/useMobileDrawer.test.tsx',
      'src/app/__tests__/useClaudiaGesture.test.tsx',
      'src/app/__tests__/useMobileNavigationGesture.test.tsx',
      'src/app/__tests__/useMobileNavigationBlocker.test.tsx',
      'src/app/__tests__/mobileNavigationGesture*.test.ts',
      'src/features/sidebar/__tests__/drawerMotion*.test.ts',
      'src/features/sidebar/__tests__/useMobileDrawerFocus.test.tsx',
    ],
    exclude: ['**/node_modules/**', '**/src-tauri/**'],
    pool: 'forks',
    testTimeout: 10000,
    hookTimeout: 10000,
    server: { deps: { inline: [/@tauri-apps\/.*/] } },
  },
});
