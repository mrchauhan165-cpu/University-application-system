import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: false,
    environment: 'node',
    environmentMatchGlobs: [['src/ui/**/*.test.tsx', 'jsdom']],
  },
});
