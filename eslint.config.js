import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**', '.data/**', '.runs/**', 'playwright-report/**', 'test-results/**'] },
  ...tseslint.configs.recommended,
  { files: ['**/*.ts', '**/*.tsx'], rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
  { files: ['src/ui/**/*.{ts,tsx}'], rules: { 'no-restricted-imports': ['error', { patterns: ['**/storage*', '**/server*', '**/api*', 'node:*'] }] } },
  { files: ['src/domain.ts'], rules: { 'no-restricted-imports': ['error', { patterns: ['node:*', './storage*', './api*', './server*', 'express'] }] } },
);
