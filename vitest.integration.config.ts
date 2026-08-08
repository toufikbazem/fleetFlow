import { defineConfig } from 'vitest/config';

/**
 * Integration tests — require a running Postgres (`npm run db:up`) and a valid
 * environment. They talk to the real database because the behaviour under test
 * is the SQL Prisma generates, which no mock can confirm.
 */
export default defineConfig({
  test: {
    // These suites deliberately provoke 5xx responses; without this the
    // expected error logs bury the actual results.
    env: { LOG_LEVEL: 'silent' },
    include: ['**/*.integration.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // A single worker: these suites share one database and create fixed-id rows.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
