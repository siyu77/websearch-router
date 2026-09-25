// ESLint 9 flat config (S4). Minimal, permissive ruleset — the goal is a working
// `npm run lint` without churning existing code. TS-aware via typescript-eslint.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/dashboard-dist/**', '**/node_modules/**', '**/*.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Permissive: don't gate on style; catch real problems only.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-require-imports': 'off',
      'no-undef': 'off', // TS handles this
      'no-empty': 'off', // deliberate try/catch swallow sites
      'no-constant-condition': 'off',
    },
  },
);
