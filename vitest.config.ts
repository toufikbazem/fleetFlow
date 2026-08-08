import { defineConfig } from 'vitest/config';

/**
 * Unit tests: no external services, safe to run anywhere.
 *
 * Integration tests (`*.integration.test.ts`) need Postgres and are run by
 * `npm run test:integration` — see vitest.integration.config.ts. They are
 * excluded here rather than skipped conditionally: a suite that silently skips
 * itself when a service is missing is a suite that stops running and nobody
 * notices.
 */
export default defineConfig({
  test: {
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.integration.test.ts'],
  },
});
