import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/out/**',
      '**/dist/**',
      '**/release/**',
      '**/test-results/**',
      '**/playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-console': 'off',
    },
  },
  {
    files: [
      'packages/ui/**/*.{ts,tsx}',
      'packages/engine/src/**/*.ts',
      'apps/photo/src/renderer/**/*.{ts,tsx}',
    ],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // The renderer is sandboxed: Node.js modules are unavailable there by design.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', 'fs', 'path', 'child_process', 'electron'],
              message: 'The renderer has no Node.js or Electron access. Use window.auram.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/photo/src/renderer/**/*.test.ts', 'packages/engine/src/**/*.test.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
);
