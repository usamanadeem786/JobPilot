import base from './base.js';

/**
 * NestJS-specific adjustments.
 *
 * `consistent-type-imports` is switched off deliberately. Nest resolves
 * constructor dependencies from the `design:paramtypes` metadata TypeScript
 * emits, and that metadata only exists for imports with a runtime binding.
 * Rewriting `import { PrismaService }` to `import type { PrismaService }` —
 * which the rule's autofix does, because the symbol only appears in a type
 * position — erases the metadata and breaks injection at runtime, with no
 * compile-time error. The rule cannot tell the two cases apart, so it does not
 * run here.
 */
export default [
  ...base,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },
];
