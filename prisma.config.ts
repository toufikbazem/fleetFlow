import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma configuration — replaces the deprecated `package.json#prisma` key,
 * which is removed in Prisma 7.
 *
 * **`dotenv/config` is imported first, and that import is load-bearing.**
 * Prisma reads `.env` automatically only when there is no config file; the
 * moment this file exists it logs "Prisma config detected, skipping environment
 * variable loading" and every CLI command fails with "Environment variable not
 * found: DATABASE_URL". Nothing else in the project changes, so the failure
 * looks like a broken database rather than a moved setting.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});
