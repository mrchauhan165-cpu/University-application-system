import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: false,
    environment: 'node',
    environmentMatchGlobs: [['src/ui/**/*.test.tsx', 'jsdom']],
    // These are deterministic tests, so the only risk is a slow shared CI runner
    // taking longer than the 5s default to render a page. Failures still surface.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
