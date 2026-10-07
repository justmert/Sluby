import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    ignores: ['**/dist/', '**/node_modules/', '**/drizzle/', '**/build/', 'resources/', '.claude/'],
  },
  {
    // Plain Node scripts (probes, one-off tooling) run under Node, not the
    // browser, so give them the Node globals they use.
    files: ['**/*.mjs', '**/scripts/**'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
      },
    },
  },
  {
    // the plain javascript example runs in the browser; .js files do not get
    // the typescript rule that turns no-undef off
    files: ['examples/vanilla/src/**/*.js'],
    languageOptions: {
      globals: {
        document: 'readonly',
        console: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        Option: 'readonly',
      },
    },
  },
  {
    // the studio: every react hooks rule, react compiler ones included, and
    // files that keep fast refresh working
    files: ['frontend/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      ...reactRefresh.configs.vite.rules,
    },
  },
  {
    // vendored shadcn components keep upstream's shape (a component next to
    // its variants or hook) so `shadcn add` updates apply cleanly, and tests
    // and their helpers are never hot reloaded
    files: [
      'frontend/src/components/ui/**',
      'frontend/src/test/**',
      'frontend/src/**/*.test.{ts,tsx}',
      // these still export helpers on this base; fix/fg10 (f30ec9b) moves them
      // into plain modules, and these two entries go with that merge
      'frontend/src/components/upload/ChunkStrip.tsx',
      'frontend/src/components/upload/PipelineSteps.tsx',
    ],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  {
    files: ['packages/player/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
);
