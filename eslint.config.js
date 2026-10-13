import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const noComments = {
  meta: {
    type: 'problem',
    schema: [],
    messages: { forbidden: 'Comments are not allowed.' },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          context.report({ loc: comment.loc, messageId: 'forbidden' });
        }
      },
    };
  },
};

export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**', '.data/**', '.runs/**', 'playwright-report/**', 'test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    linterOptions: { noInlineConfig: true },
    plugins: { local: { rules: { 'no-comments': noComments } } },
    rules: { 'local/no-comments': 'error' },
  },
  { files: ['**/*.{js,mjs,cjs,ts,tsx}'], rules: { eqeqeq: ['error', 'always'] } },
  { files: ['**/*.{js,mjs}'], languageOptions: { globals: globals.nodeBuiltin } },
  { files: ['**/*.cjs'], languageOptions: { globals: globals.node } },
  { files: ['scripts/check-learning-workbook.mjs'], languageOptions: { globals: globals.browser } },
  { files: ['**/*.ts', '**/*.tsx'], rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
  {
    files: ['src/ui/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'no-restricted-imports': ['error', { patterns: ['**/storage*', '**/server*', '**/api*', 'node:*'] }],
    },
  },
  { files: ['src/domain.ts'], rules: { 'no-restricted-imports': ['error', { patterns: ['node:*', './storage*', './api*', './server*', 'express'] }] } },
);
