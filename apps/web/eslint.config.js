import base from '@jobpilot/config/eslint/base.js';

export default [
  ...base,
  {
    rules: {
      // Server Components legitimately return promises from the default export.
      '@typescript-eslint/require-await': 'off',
    },
  },
];
