import js from '@eslint/js';
import ts from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

/**
 * @type {import('eslint').Linter.Config[]}
 */
export default [
  // 忽略文件
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/bundle/**',
      '**/.pnpm-store/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/.cache/**',
      '**/.worktrees/**',
      '**/.claude/**',
      '**/.claire/**',
      '**/.zclaudia/**',
      // Tauri 生成的文件
      '**/src-tauri/target/**',
      '**/src-tauri/gen/**',
    ],
  },

  // 基础 JS/TS 规则 (适用于所有项目)
  js.configs.recommended,
  ...ts.configs.recommended,

  // 通用配置
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.es2022,
        ...globals.node,
      },
    },
    rules: {
      // 通用最佳实践
      'no-console': 'off', // 允许 console，因为是 CLI 工具
      'no-debugger': 'warn',
      'no-unused-vars': 'off', // 使用 TypeScript 的 no-unused-vars
      'prefer-const': 'warn',
      'no-var': 'error',
      // ESLint 10 新增 — 当前代码有几处真实命中，作为 backlog 不阻断 CI
      'no-useless-assignment': 'warn',

      // TypeScript 特定规则
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        {
          prefer: 'type-imports',
          fixStyle: 'inline-type-imports',
        },
      ],
      // ESLint 10 新增 — 命中点都是 catch (err) 后 throw new Error 没传 cause，
      // 真实的可观测性改进，作为 backlog 不阻断 CI
      'preserve-caught-error': 'warn',
    },
  },

  // React 项目特定配置 (desktop)
  {
    files: ['apps/desktop/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // eslint-plugin-react-hooks v7 added a React-Compiler-derived ruleset.
      // The new rules surface real anti-patterns (setState in effect, refs read
      // during render, impure functions in render, etc.) but the existing code
      // has many pre-existing hits. Demote each to `warn` for now so they show
      // up as backlog without blocking CI; address in focused follow-ups.
      'react-hooks/static-components': 'warn',
      'react-hooks/use-memo': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/globals': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/error-boundaries': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/set-state-in-render': 'warn',
      'react-hooks/config': 'warn',
      'react-hooks/gating': 'warn',
      // Classic two stay at their recommended levels (rules-of-hooks=error,
      // exhaustive-deps=warn) — those have been our hard guards all along.
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // 测试文件宽松规则
  {
    files: [
      '**/*.test.{ts,tsx}',
      '**/*.spec.{ts,tsx}',
      '**/e2e/**/*.ts',
      'apps/desktop/src/test/**/*.{ts,tsx}',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
    },
  },
];
