import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// Structurally enforces the repo's no-hooks rule (CONVENTIONS.md: "No React
// hooks"): React hooks are banned EXCEPT the single navigation bridge
// `src/lib/withRouter.tsx`. A grep alone misses member forms
// like `React.useEffect`; this catches both the bare-call and
// member-expression forms.
const HOOK_CALL = 'CallExpression[callee.name=/^use[A-Z]/]'
const HOOK_MEMBER = 'MemberExpression[property.name=/^use[A-Z]/]'
const NO_HOOKS_MESSAGE =
  'React hooks are banned outside src/lib/withRouter.tsx (CONVENTIONS.md: no hooks except the router bridge). Use Redux + recompose HOCs instead.'

export default defineConfig([
  globalIgnores(['dist', 'dist-server', 'storybook-static']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // `withRouter`/`connect`/`compose` (recompose HOC chains, e.g.
      // `export default compose(...)(View)`) wrap screen exports; treat them
      // as component exports for react-refresh.
      'react-refresh/only-export-components': [
        'error',
        { allowConstantExport: true, extraHOCs: ['withRouter', 'connect', 'compose'] },
      ],
      // `_`-prefixed unused vars and args mark a value as deliberately
      // discarded; never flag them as unused.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-restricted-syntax': [
        'error',
        { selector: HOOK_CALL, message: NO_HOOKS_MESSAGE },
        { selector: HOOK_MEMBER, message: NO_HOOKS_MESSAGE },
      ],
    },
  },
  {
    // Test files keep the BARE-CALL ban (a test must not call a React hook
    // either) but drop the MEMBER form: `vi.useFakeTimers()` /
    // `vi.useRealTimers()` are vitest APIs, not React hooks, and they match
    // `MemberExpression[property.name=/^use[A-Z]/]` exactly. Without this
    // override the only way to call them is a bracket-access hack, which is
    // noise in test files.
    files: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', { selector: HOOK_CALL, message: NO_HOOKS_MESSAGE }],
    },
  },
  {
    // The ONE permitted hooks file — the react-router bridge (CONVENTIONS.md:
    // "The ONLY file allowed to use hooks is src/lib/withRouter.tsx").
    files: ['src/lib/withRouter.tsx'],
    rules: { 'no-restricted-syntax': 'off' },
  },
])
