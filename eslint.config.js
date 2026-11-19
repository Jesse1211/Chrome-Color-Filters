import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * ESLint 配置(DESIGN.md §7:LINT_CMD = `npm run lint`)。
 */
export default tseslint.config(
  {
    ignores: [
      '.output/**',
      '.wxt/**',
      'node_modules/**',
      'stats*.html',
      // T0 spike 的实验脚本与证据产物(docs/T0-spike/**)是上一任务的研究
      // 交接材料,不是本扩展的产品代码,不纳入 lint 范围。
      'docs/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    files: ['entrypoints/**/*.tsx', 'src/ui/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // ADR-036:领域层是纯 TypeScript,这里额外把「禁止 import 框架/扩展 API」
    // 做成 lint 规则,与 purity.test.ts 的静态检查互为第二道防线。
    files: ['src/domain/**/*.ts'],
    ignores: ['src/domain/__tests__/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: ['react', 'react-dom', 'wxt', 'wxt/*', 'webextension-polyfill'],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'chrome', message: 'ADR-036: src/domain 禁止使用 chrome.* 扩展 API' },
        { name: 'browser', message: 'ADR-036: src/domain 禁止使用 browser.* 扩展 API' },
      ],
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
);
