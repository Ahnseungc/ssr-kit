import { builtinModules } from 'node:module';

import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/', '**/dist/', '**/coverage/', '**/test-results/', '**/.wrangler/', '.claude/'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  prettier,
  {
    files: ['**/scripts/**/*.mjs'],
    languageOptions: {
      // record-demo 는 page.evaluate 안에서 document 를 쓴다
      globals: { process: 'readonly', console: 'readonly', document: 'readonly' },
    },
  },
  {
    plugins: { 'simple-import-sort': simpleImportSort },
    rules: {
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { varsIgnorePattern: '^_', argsIgnorePattern: '^_' },
      ],
      'simple-import-sort/exports': 'warn',
      'simple-import-sort/imports': [
        'warn',
        {
          groups: [
            ['^\\u0000'],
            [`^node:`, `^(${builtinModules.join('|')})(/|$)`],
            ['^@?\\w'],
            ['^\\.\\.(?!/?$)', '^\\.\\./?$', '^\\./(?=.*/)(?!/?$)', '^\\.(?!/?$)', '^\\./?$'],
          ],
        },
      ],
    },
  },
);
