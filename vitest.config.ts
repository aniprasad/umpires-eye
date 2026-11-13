import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    // the data tools test themselves with node:test
    exclude: [...configDefaults.exclude, 'tools/data/**'],
    environment: 'node',
    testTimeout: 60_000,
  },
});
