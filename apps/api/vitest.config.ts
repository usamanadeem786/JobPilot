import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Nest relies on `emitDecoratorMetadata`, which esbuild (Vitest's default
 * transformer) does not produce. SWC is used instead so dependency injection
 * by type keeps working inside tests.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: './',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    /*
     * The e2e suite talks to a real Postgres, which in practice is a managed
     * one in another region: measured at ~500ms per round trip and ~2.5s to
     * wake a scale-to-zero compute. A registration makes five or six queries,
     * so Vitest's 5s default fails on latency rather than on a defect. Unit
     * tests are unaffected — they never wait on anything.
     */
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.module.ts', 'src/main.ts'],
    },
  },
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
});
