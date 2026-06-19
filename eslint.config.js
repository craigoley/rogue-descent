// ESLint flat config (eslint.config.js). typescript-eslint "recommended" (syntactic — no type
// info needed, so it's fast and CI-stable). Build (tsc) handles type errors;
// this catches lint-class issues (unused vars, unsafe patterns, etc).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  // Generated / vendored output is never linted.
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // The game ships to the browser; tests run under jsdom — both browser-global.
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    // Node-context files: build/test config + the Playwright E2E specs (they use
    // process.env + run under Node, not the browser). Add node globals so the
    // syntactic lint doesn't flag them.
    files: ['*.config.{js,ts}', 'tests/e2e/**'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // Additive bug-catching hardening (security-tooling playbook) — catch debugging
    // artifacts + footguns that should never ship. All zero-violation on the current
    // tree; they guard FUTURE drift. `no-console` is intentionally OMITTED: src/ uses
    // console deliberately for the always-on softlock/funnel telemetry (the ?debug
    // surface), so flagging it would be noise, not signal. (`no-debugger` is also in
    // eslint:recommended; kept explicit so the hardening is self-documenting.)
    rules: {
      'no-debugger': 'error',
      'no-alert': 'error',
      'no-var': 'error',
    },
  },
);
