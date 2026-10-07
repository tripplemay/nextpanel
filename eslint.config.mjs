import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/coverage/**', 'out/**'] },
  {
    files: ['apps/server/src/**/*.ts', 'apps/web/src/**/*.{ts,tsx}', 'packages/shared/src/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    rules: {
      // Keep the initial gate focused on correctness, not a repository-wide style migration.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-empty-object-type': ['error', { allowInterfaces: 'with-single-extends' }],
    },
  },
  {
    files: ['apps/server/src/**/*.ts'],
    rules: { '@typescript-eslint/no-require-imports': ['error', { allow: ['^(?:node:)?(?:crypto|child_process)$'] }] },
  },
  {
    files: ['**/*.spec.ts'],
    // Jest deliberately loads mocks at runtime and accepts generic event callbacks.
    rules: { '@typescript-eslint/no-require-imports': 'off', '@typescript-eslint/no-unsafe-function-type': 'off' },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/rules-of-hooks': 'error' },
  },
);
