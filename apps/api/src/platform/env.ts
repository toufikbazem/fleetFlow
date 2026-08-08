/**
 * Environment validation — FF-102.
 *
 * Configuration is parsed and validated once, at boot, into a frozen typed
 * object. Nothing else in the codebase reads `process.env`: a typo in a
 * variable name becomes a startup failure with a precise message rather than an
 * `undefined` that surfaces at 07:00 when the notification job tries to send.
 *
 * Two tiers, because the project is being built before its accounts exist:
 *
 *   REQUIRED  absent → the process refuses to start, in every environment.
 *   FEATURE   absent → in development the feature reports itself unconfigured
 *             and the API still boots; in production it is required.
 *
 * A partially configured feature is a hard error everywhere. Someone who filled
 * in SMTP_HOST and forgot SMTP_FROM has made a mistake, not a decision, and the
 * failure should be loud and immediate rather than a rejected message later.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const booleanish = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v) => ['true', 'false', '1', '0', 'yes', 'no', ''].includes(v), {
    message: 'Expected a boolean such as true/false',
  })
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const NODE_ENVS = ['development', 'test', 'production'] as const;
export type NodeEnvName = (typeof NODE_ENVS)[number];

const requiredSchema = z.object({
  NODE_ENV: z.enum(NODE_ENVS).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  // `silent` is pino's own "log nothing"; useful for test runs where the
  // expected-error output would otherwise bury the results.
  LOG_LEVEL: z.enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  APP_URL: z.string().url(),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),

  DATABASE_URL: z.string().min(1).startsWith('postgres'),
  REDIS_URL: z.string().min(1).startsWith('redis'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
});

const storageSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_BUCKET: z.string().min(1),
});

const emailSchema = z.object({
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535),
  SMTP_USER: z.string().min(1),
  SMTP_PASSWORD: z.string().min(1),
  SMTP_FROM: z.string().min(1),
  SMTP_SECURE: booleanish.default('false'),
});

/** Every variable belonging to each optional feature, for presence detection. */
const FEATURE_VARS = {
  storage: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_BUCKET'],
  email: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'],
} as const satisfies Record<string, readonly string[]>;

export type FeatureName = keyof typeof FEATURE_VARS;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface StorageConfig {
  url: string;
  serviceRoleKey: string;
  bucket: string;
}

export interface EmailConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
  secure: boolean;
}

export interface AppEnv {
  nodeEnv: NodeEnvName;
  isProduction: boolean;
  isTest: boolean;
  port: number;
  logLevel: z.infer<typeof requiredSchema>['LOG_LEVEL'];
  appUrl: string;
  corsOrigins: string[];
  databaseUrl: string;
  redisUrl: string;
  jwtSecret: string;
  accessTokenTtlMinutes: number;
  refreshTokenTtlDays: number;
  /** Null when the feature is unconfigured — only possible outside production. */
  storage: StorageConfig | null;
  email: EmailConfig | null;
}

export type EnvParseResult =
  { ok: true; env: AppEnv; warnings: string[] } | { ok: false; errors: string[] };

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function isPresent(source: NodeJS.ProcessEnv, key: string): boolean {
  return (source[key] ?? '').trim().length > 0;
}

function formatIssues(prefix: string, error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.');
    return `${prefix}${path ? `${path}: ` : ''}${issue.message}`;
  });
}

/**
 * Pure: reads the supplied source rather than `process.env`, so tests can drive
 * it without mutating global state.
 */
export function parseEnv(source: NodeJS.ProcessEnv): EnvParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const base = requiredSchema.safeParse(source);
  if (!base.success) {
    errors.push(...formatIssues('', base.error));
    // Without NODE_ENV resolved, feature-tier rules cannot be applied correctly.
    return { ok: false, errors };
  }

  const nodeEnv = base.data.NODE_ENV;
  const isProduction = nodeEnv === 'production';

  function resolveFeature<T extends z.ZodTypeAny>(name: FeatureName, schema: T): z.infer<T> | null {
    const vars = FEATURE_VARS[name];
    const present = vars.filter((key) => isPresent(source, key));

    if (present.length === 0) {
      if (isProduction) {
        errors.push(`${name}: required in production but unconfigured — set ${vars.join(', ')}`);
      } else {
        warnings.push(
          `${name} is UNCONFIGURED (${vars.join(', ')} are empty). ` +
            `The API will start, but any request needing it fails with 503 SERVICE_UNCONFIGURED.`,
        );
      }
      return null;
    }

    // Partially configured — always fatal. See the file header.
    if (present.length < vars.length) {
      const missing = vars.filter((key) => !isPresent(source, key));
      errors.push(
        `${name} is partially configured — missing ${missing.join(', ')}. ` +
          `Set all of ${vars.join(', ')}, or leave every one of them empty.`,
      );
      return null;
    }

    const parsed = schema.safeParse(source);
    if (!parsed.success) {
      errors.push(...formatIssues(`${name}: `, parsed.error));
      return null;
    }
    return parsed.data;
  }

  const storageRaw = resolveFeature('storage', storageSchema);
  const emailRaw = resolveFeature('email', emailSchema);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const env: AppEnv = {
    nodeEnv,
    isProduction,
    isTest: nodeEnv === 'test',
    port: base.data.PORT,
    logLevel: base.data.LOG_LEVEL,
    appUrl: base.data.APP_URL,
    corsOrigins: base.data.CORS_ORIGINS,
    databaseUrl: base.data.DATABASE_URL,
    redisUrl: base.data.REDIS_URL,
    jwtSecret: base.data.JWT_SECRET,
    accessTokenTtlMinutes: base.data.ACCESS_TOKEN_TTL_MINUTES,
    refreshTokenTtlDays: base.data.REFRESH_TOKEN_TTL_DAYS,
    storage: storageRaw
      ? {
          url: storageRaw.SUPABASE_URL,
          serviceRoleKey: storageRaw.SUPABASE_SERVICE_ROLE_KEY,
          bucket: storageRaw.SUPABASE_BUCKET,
        }
      : null,
    email: emailRaw
      ? {
          host: emailRaw.SMTP_HOST,
          port: emailRaw.SMTP_PORT,
          user: emailRaw.SMTP_USER,
          password: emailRaw.SMTP_PASSWORD,
          from: emailRaw.SMTP_FROM,
          secure: emailRaw.SMTP_SECURE,
        }
      : null,
  };

  return { ok: true, env: Object.freeze(env), warnings };
}

// ---------------------------------------------------------------------------
// Locating the .env file
// ---------------------------------------------------------------------------

/**
 * The `.env` lives at the monorepo root, but the API is started from several
 * working directories: the repo root (`node apps/api/dist/index.js`), the
 * package directory (`npm run dev:api`, which npm runs with cwd=apps/api), and
 * an editor's or test runner's own choice.
 *
 * Resolving relative to `process.cwd()` — dotenv's default — therefore works
 * from one of those and silently fails from the others, producing a confusing
 * "DATABASE_URL: Required" when the file is sitting right there. So the file is
 * located by walking upward instead.
 *
 * The walk stops at the monorepo root (the package.json declaring workspaces)
 * so a stray `.env` in a parent directory outside the project can never be
 * picked up by accident.
 */
function isMonorepoRoot(dir: string): boolean {
  const manifest = path.join(dir, 'package.json');
  if (!existsSync(manifest)) return false;
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifest, 'utf8'));
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      Array.isArray((parsed as { workspaces?: unknown }).workspaces)
    );
  } catch {
    return false;
  }
}

/** Exported for testing; pass explicit start directories. */
export function findEnvFile(startDirs: readonly string[]): string | undefined {
  for (const start of startDirs) {
    let dir = path.resolve(start);
    for (;;) {
      const candidate = path.join(dir, '.env');
      if (existsSync(candidate)) return candidate;
      // Check the root itself, then stop — never escape the project.
      if (isMonorepoRoot(dir)) break;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return undefined;
}

function defaultEnvSearchPaths(): string[] {
  // cwd first so a package-local .env can override; then the location of this
  // module, which is stable no matter where the process was launched from.
  return [process.cwd(), path.dirname(fileURLToPath(import.meta.url))];
}

// ---------------------------------------------------------------------------
// Boot-time singleton
// ---------------------------------------------------------------------------

let cached: AppEnv | undefined;
let cachedWarnings: string[] = [];
let cachedEnvFile: string | undefined;

/**
 * Validates the process environment, throwing a readable report if it is
 * unusable. Called once from the API entrypoint before anything else runs.
 *
 * A missing `.env` is not itself an error: CI and real environments supply
 * variables directly. Validation then fails on the variables, not the file.
 */
export function loadEnv(): AppEnv {
  if (cached) return cached;

  // ENV_FILE is an explicit instruction, so a bad path is a hard error rather
  // than a silent fallback to whatever the search would have found.
  const explicit = process.env['ENV_FILE'];
  if (explicit) {
    if (!existsSync(explicit)) {
      throw new Error(`ENV_FILE points at "${explicit}", which does not exist.`);
    }
    cachedEnvFile = explicit;
  } else {
    cachedEnvFile = findEnvFile(defaultEnvSearchPaths());
  }

  if (cachedEnvFile) {
    loadDotenv({ path: cachedEnvFile, override: false });
  }

  const result = parseEnv(process.env);
  if (!result.ok) {
    const searched = cachedEnvFile
      ? `Loaded ${cachedEnvFile}`
      : `No .env file was found (searched upward from ${defaultEnvSearchPaths().join(' and ')})`;
    const report = [
      '',
      'FleetFlow cannot start — the environment is invalid:',
      ...result.errors.map((e) => `  • ${e}`),
      '',
      searched,
      'See .env.example for the full list of variables.',
      '',
    ].join('\n');
    throw new Error(report);
  }

  cached = result.env;
  cachedWarnings = result.warnings;
  return cached;
}

/** Absolute path of the `.env` that was loaded, if any. For diagnostics. */
export function loadedEnvFile(): string | undefined {
  return cachedEnvFile;
}

/** Warnings collected by the last `loadEnv()`; emitted once the logger exists. */
export function envWarnings(): string[] {
  return cachedWarnings;
}

/** Test seam. Never call this from application code. */
export function resetEnvForTests(): void {
  cached = undefined;
  cachedWarnings = [];
  cachedEnvFile = undefined;
}

// ---------------------------------------------------------------------------
// Feature gates
// ---------------------------------------------------------------------------

/**
 * Thrown when a request reaches code whose feature was never configured. The
 * `code` maps to 503 through HTTP_STATUS_BY_ERROR_CODE in @fleetflow/shared,
 * and the message names the variables to set — so the fix is in the response,
 * not buried in a stack trace.
 */
export class ServiceUnconfiguredError extends Error {
  readonly code = 'SERVICE_UNCONFIGURED' as const;
  readonly feature: FeatureName;
  readonly missing: readonly string[];

  constructor(feature: FeatureName) {
    const vars = FEATURE_VARS[feature];
    super(`The ${feature} service is not configured. Set ${vars.join(', ')} to enable it.`);
    this.name = 'ServiceUnconfiguredError';
    this.feature = feature;
    this.missing = vars;
  }
}

export function requireStorage(env: AppEnv): StorageConfig {
  if (!env.storage) throw new ServiceUnconfiguredError('storage');
  return env.storage;
}

export function requireEmail(env: AppEnv): EmailConfig {
  if (!env.email) throw new ServiceUnconfiguredError('email');
  return env.email;
}
