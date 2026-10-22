import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import jsxA11y from 'eslint-plugin-jsx-a11y-x';
import reactHooks from 'eslint-plugin-react-hooks';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import { mcPlugin } from './eslint-plugin/index.js';

const TS_FILES = ['**/*.{ts,tsx,mts,cts}'];
const JS_FILES = ['**/*.{js,mjs,cjs}'];
/** Browser/React code: both PWAs, the UI package and the i18n runtime. */
const UI_FILES = [
  'apps/app/**/*.{ts,tsx}',
  'apps/admin/**/*.{ts,tsx}',
  'packages/ui/**/*.{ts,tsx}',
  'packages/i18n/src/**/*.{ts,tsx}',
];

const MONGODB_MESSAGE =
  'The MongoDB driver may only be imported inside packages/db. Use the scoped repositories (withScope / withTransaction).';
const SYSTEM_SCOPE_MESSAGE =
  'systemScope() may only be used in packages/api/src/jobs/** (worker) and scripts/** (DECISIONS #7, #20).';
const HOOK_SCOPE_MESSAGE = 'hookScope() may only be used in packages/api/src/hooks/** (DECISIONS #20).';

const restrictMongodb = {
  paths: [{ name: 'mongodb', message: MONGODB_MESSAGE }],
  patterns: [{ group: ['mongodb/*'], message: MONGODB_MESSAGE }],
};
const restrictSystemScope = { regex: '^@mc/db(/.*)?$', importNames: ['systemScope'], message: SYSTEM_SCOPE_MESSAGE };
const restrictHookScope = { regex: '^@mc/db(/.*)?$', importNames: ['hookScope'], message: HOOK_SCOPE_MESSAGE };

/** Rejects `import('mongodb')` / `require('mongodb')`, which no-restricted-imports does not see. */
const dynamicMongodbSyntax = [
  { selector: 'ImportExpression[source.value=/^mongodb(\\u002F.*)?$/]', message: MONGODB_MESSAGE },
  {
    selector: "CallExpression[callee.name='require'][arguments.0.value=/^mongodb(\\u002F.*)?$/]",
    message: MONGODB_MESSAGE,
  },
];

/**
 * Namespace, dynamic and `require` imports of `@mc/db` would reach `systemScope` / `hookScope` as members, which
 * no-restricted-imports does not see (phase-verifier 22 Oct 2026). Nothing needs them: named imports only.
 */
const DB_MODULE = '/^@mc\\u002Fdb(\\u002F.*)?$/';
const DB_NAMED_ONLY_MESSAGE =
  'Import from @mc/db by name only (no namespace, dynamic or require imports) — they would bypass the systemScope / hookScope bans.';
const namedDbImportsSyntax = [
  {
    selector: `ImportDeclaration[source.value=${DB_MODULE}] > ImportNamespaceSpecifier`,
    message: DB_NAMED_ONLY_MESSAGE,
  },
  { selector: `ExportAllDeclaration[source.value=${DB_MODULE}]`, message: DB_NAMED_ONLY_MESSAGE },
  { selector: `ImportExpression[source.value=${DB_MODULE}]`, message: DB_NAMED_ONLY_MESSAGE },
  {
    selector: `CallExpression[callee.name='require'][arguments.0.value=${DB_MODULE}]`,
    message: DB_NAMED_ONLY_MESSAGE,
  },
  // Re-exporting a scope from an allowed area (jobs, hooks) would launder it to any importer (security review L4).
  {
    selector: 'ExportSpecifier[local.name=/^(systemScope|hookScope)$/]',
    message: 'systemScope / hookScope are never re-exported — import them from @mc/db where they are allowed.',
  },
  {
    selector: 'ExportNamedDeclaration VariableDeclarator[init.name=/^(systemScope|hookScope)$/]',
    message: 'systemScope / hookScope are never re-exported — import them from @mc/db where they are allowed.',
  },
  {
    selector: 'ExportDefaultDeclaration > Identifier[name=/^(systemScope|hookScope)$/]',
    message: 'systemScope / hookScope are never re-exported; import them from @mc/db where they are allowed.',
  },
  // Under their own name only, so the checks above see every use (security review 22 Oct 2026, L1).
  {
    selector: "ImportSpecifier[imported.name='systemScope'][local.name!='systemScope']",
    message: 'Import systemScope under its own name (no alias).',
  },
  {
    selector: "ImportSpecifier[imported.name='hookScope'][local.name!='hookScope']",
    message: 'Import hookScope under its own name (no alias).',
  },
];

/**
 * Server code (api package, server app) is ESM with literal imports only: a computed `import()` source or `require`
 * would load `@mc/db` past every check above (security review L4).
 */
const SERVER_LITERAL_IMPORTS_MESSAGE =
  'Server code imports by literal module name only (no computed import() source, no require / createRequire).';
const serverLiteralImportsSyntax = [
  { selector: "ImportExpression:not([source.type='Literal'])", message: SERVER_LITERAL_IMPORTS_MESSAGE },
  { selector: "CallExpression[callee.name='require']", message: SERVER_LITERAL_IMPORTS_MESSAGE },
  { selector: "CallExpression[callee.name='createRequire']", message: SERVER_LITERAL_IMPORTS_MESSAGE },
  {
    selector: 'MemberExpression[property.name=/^(createRequire|getBuiltinModule)$/]',
    message: SERVER_LITERAL_IMPORTS_MESSAGE,
  },
];
const restrictCreateRequire = {
  regex: '^(node:)?module$',
  importNames: ['createRequire'],
  message: SERVER_LITERAL_IMPORTS_MESSAGE,
};

/**
 * API code outside jobs/ never imports from jobs/: a job helper may call systemScope() inside, which no import ban on
 * @mc/db can see (security review 22 Oct 2026, L1). The worker / CLI entrypoints in apps/server and the test hooks may.
 */
const restrictJobsImports = {
  group: ['**/jobs/**', '**/jobs/*', '@mc/api/jobs/*'],
  message: 'Only jobs/, the server entrypoints and the test hooks import from jobs/ (job code may run as systemScope).',
};

/**
 * Playwright's `waitForFunction` does not await a Promise: an async predicate is truthy at once and the wait
 * is a no-op (found in T0.12 — it made the PWA offline spec flaky). Poll async checks with `expect.poll`.
 */
const asyncWaitForFunctionSyntax = [
  {
    selector:
      "CallExpression[callee.property.name='waitForFunction'] > :matches(ArrowFunctionExpression, FunctionExpression)[async=true]",
    message:
      'waitForFunction() does not await async predicates (a Promise is truthy, so it returns at once). Use expect.poll(() => page.evaluate(async () => …)).',
  },
];

/**
 * @param {{ systemScope: boolean, hookScope: boolean, mongodb: boolean, server?: boolean, noJobs?: boolean }} allowed
 *   `server`: server code (literal imports only); `noJobs`: API code that may not import from jobs/.
 * @returns {import('eslint').Linter.RulesRecord}
 */
function importRestrictions(allowed) {
  const patterns = [
    ...(allowed.mongodb ? [] : restrictMongodb.patterns),
    ...(allowed.systemScope ? [] : [restrictSystemScope]),
    ...(allowed.hookScope ? [] : [restrictHookScope]),
    ...(allowed.server ? [restrictCreateRequire] : []),
    ...(allowed.noJobs ? [restrictJobsImports] : []),
  ];
  return {
    'no-restricted-imports': ['error', { paths: allowed.mongodb ? [] : restrictMongodb.paths, patterns }],
    'no-restricted-syntax': [
      'error',
      ...(allowed.mongodb ? [] : dynamicMongodbSyntax),
      ...(allowed.systemScope && allowed.hookScope ? [] : namedDbImportsSyntax),
      ...(allowed.server ? serverLiteralImportsSyntax : []),
      ...asyncWaitForFunctionSyntax,
    ],
  };
}

/**
 * Builds the repository's flat ESLint config.
 *
 * @param {{ tsconfigRootDir: string, typeAware?: boolean }} options
 *   `tsconfigRootDir` — repository root (for the TypeScript project service).
 *   `typeAware` — `false` skips type information (used by the lint-rule fixture tests, which lint
 *   virtual files that belong to no tsconfig). CI and editors always use `true`.
 * @returns {import('eslint').Linter.Config[]}
 */
export function createConfig({ tsconfigRootDir, typeAware = true }) {
  const tsConfigs = typeAware ? tseslint.configs.strictTypeChecked : tseslint.configs.strict;

  return /** @type {import('eslint').Linter.Config[]} */ ([
    {
      name: 'mc/ignores',
      ignores: [
        '**/node_modules/**',
        '**/dist/**',
        '**/dist-test/**',
        // Semgrep rule fixtures: deliberately bad code.
        '.semgrep/**',
        '**/build/**',
        '**/coverage/**',
        '**/.turbo/**',
        '**/playwright-report/**',
        '**/test-results/**',
        '**/*.gen.ts',
        '.claude/**',
        'docs/**',
        'owner/**',
      ],
    },
    { name: 'mc/linter-options', linterOptions: { reportUnusedDisableDirectives: 'error' } },

    { ...js.configs.recommended, name: 'eslint/recommended' },

    ...tsConfigs.map((compatible) => {
      const config = /** @type {import('eslint').Linter.Config} */ (compatible);
      return { ...config, files: config.files ?? TS_FILES };
    }),
    {
      name: 'mc/typescript',
      files: TS_FILES,
      languageOptions: typeAware ? { parserOptions: { projectService: true, tsconfigRootDir } } : {},
      rules: {
        '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
        '@typescript-eslint/no-import-type-side-effects': 'error',
        '@typescript-eslint/switch-exhaustiveness-check': typeAware ? 'error' : 'off',
        '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
        // `as` casts only at validated boundaries, with a comment (CLAUDE.md §6).
        '@typescript-eslint/consistent-type-assertions': [
          'error',
          { assertionStyle: 'as', objectLiteralTypeAssertions: 'never' },
        ],
      },
    },
    // Plain JS files (config package, scripts) are type-checked by tsc (checkJs) but linted without types.
    { ...tseslint.configs.disableTypeChecked, name: 'mc/js-no-type-info', files: JS_FILES },

    {
      name: 'mc/base',
      languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.es2024 } },
      plugins: { 'simple-import-sort': simpleImportSort },
      rules: {
        'no-console': 'error',
        eqeqeq: ['error', 'always'],
        'no-implicit-coercion': 'error',
        'no-param-reassign': 'error',
        'prefer-const': 'error',
        'simple-import-sort/imports': 'error',
        'simple-import-sort/exports': 'error',
      },
    },
    {
      name: 'mc/node-globals',
      files: [
        'apps/server/**',
        'packages/api/**',
        'packages/db/**',
        'packages/config/**',
        'scripts/**',
        '**/*.config.*',
      ],
      languageOptions: { globals: { ...globals.node } },
    },

    // React / browser code.
    {
      ...reactHooks.configs.flat.recommended,
      name: 'react-hooks/recommended',
      files: UI_FILES,
    },
    { ...jsxA11y.configs.strict, name: 'jsx-a11y-x/strict', files: UI_FILES },
    {
      name: 'mc/ui',
      files: UI_FILES,
      languageOptions: { globals: { ...globals.browser } },
      plugins: { mc: mcPlugin },
      rules: {
        'mc/no-physical-direction': 'error',
        'mc/no-adhoc-motion': 'error',
        'no-restricted-globals': [
          'error',
          {
            name: 'localStorage',
            message: 'Use the device store (IndexedDB). localStorage is only for the boot-time locale mirror.',
          },
        ],
      },
    },
    { name: 'mc/ui-motion-presets', files: ['packages/ui/src/motion/**'], rules: { 'mc/no-adhoc-motion': 'off' } },

    // API: routes only via defineRoute().
    {
      name: 'mc/api-routes',
      files: ['packages/api/**/*.{ts,tsx}', 'apps/server/**/*.{ts,tsx}'],
      plugins: { mc: mcPlugin },
      rules: { 'mc/no-raw-routes': 'error' },
    },
    {
      name: 'mc/api-define-route',
      files: ['packages/api/src/http/define-route.ts'],
      rules: { 'mc/no-raw-routes': 'off' },
    },
    {
      // The app factory creates the Express apps and routers; tests build small apps around single helpers.
      name: 'mc/api-app-factory',
      files: ['packages/api/src/app.ts', 'packages/api/test/**', 'apps/server/test/**'],
      rules: { 'mc/no-raw-routes': ['error', { allowCreate: true }] },
    },

    // Import bans (CLAUDE.md §6 Structure). Later entries override earlier ones for their files.
    { name: 'mc/imports-default', rules: importRestrictions({ mongodb: false, systemScope: false, hookScope: false }) },
    {
      name: 'mc/imports-api',
      files: ['packages/api/src/**'],
      rules: importRestrictions({ mongodb: false, systemScope: false, hookScope: false, server: true, noJobs: true }),
    },
    {
      // Entrypoints (worker, bootstrap CLI) and the test hooks call job code.
      name: 'mc/imports-server-entrypoints',
      files: ['apps/server/src/**', 'packages/api/src/test-hooks/**'],
      rules: importRestrictions({ mongodb: false, systemScope: false, hookScope: false, server: true }),
    },
    {
      name: 'mc/imports-jobs',
      files: ['packages/api/src/jobs/**'],
      rules: importRestrictions({ mongodb: false, systemScope: true, hookScope: false, server: true }),
    },
    {
      name: 'mc/imports-scripts',
      files: ['scripts/**'],
      rules: importRestrictions({ mongodb: false, systemScope: true, hookScope: false }),
    },
    {
      name: 'mc/imports-hooks',
      files: ['packages/api/src/hooks/**'],
      rules: importRestrictions({ mongodb: false, systemScope: false, hookScope: true, server: true, noJobs: true }),
    },
    {
      name: 'mc/imports-db',
      files: ['packages/db/**'],
      rules: importRestrictions({ mongodb: true, systemScope: true, hookScope: true }),
    },

    // Tests may use non-null assertions on fixtures they just created.
    {
      name: 'mc/tests',
      files: ['**/*.test.{ts,tsx}', '**/test/**/*.{ts,tsx}', 'e2e/**/*.ts'],
      rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
    },

    { ...prettier, name: 'prettier' },
  ]);
}
