import nest from '@jobpilot/config/eslint/nest.js';

export default [
  ...nest,
  {
    // Admin CLI scripts talk to an operator through stdout; that is their
    // entire interface, not stray debugging.
    files: ['scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
];
