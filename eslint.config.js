import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'test-results/', 'playwright-report/', 'blob-report/', 'mockup/', 'public/'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { '@stylistic': stylistic },
    rules: {
      // The owner's style (AGENTS.md): a blank line after declarations, and before a return that follows other statements.
      '@stylistic/padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: ['const', 'let', 'var'], next: '*' },
        { blankLine: 'any', prev: ['const', 'let', 'var'], next: ['const', 'let', 'var'] },
        { blankLine: 'always', prev: '*', next: 'return' },
      ],
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    // src/core is shared with the data tools, which run it under plain Node: no packages, Node modules, DOM or Vite,
    // relative imports spelled out to the file, and every draw from a seeded rand passed in. src/core/tsconfig.json
    // backs this up with ECMAScript's globals only.
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ regex: '^(?!\\./)', message: "Core imports only its own files ('./name.ts')." }] }],
      'no-restricted-syntax': [
        'error',
        ...['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].map((node) => ({
          selector: `${node}[source.value=/^\\./][source.value!=/\\.ts$/]`,
          message: "Relative imports in core end in '.ts': Node won't resolve a path without its extension.",
        })),
        { selector: 'ImportExpression', message: 'Core has no dynamic imports.' },
        { selector: "MemberExpression[object.type='MetaProperty'][property.name='env']", message: 'Core has no import.meta.env: it exists only under Vite.' },
        { selector: "MemberExpression[object.name='Math'][property.name='random']", message: 'Core takes a seeded rand instead of calling Math.random.' },
      ],
      'no-restricted-globals': [
        'error',
        ...['window', 'document', 'navigator', 'location', 'self', 'globalThis', 'fetch', 'localStorage', 'sessionStorage', 'performance',
          'requestAnimationFrame', 'requestIdleCallback', 'setTimeout', 'setInterval', 'console', 'process', 'Buffer', 'require', 'module',
          '__dirname', '__filename', 'global'].map((name) => ({ name, message: 'Core is pure: no DOM or Node globals.' })),
      ],
    },
  },
);
