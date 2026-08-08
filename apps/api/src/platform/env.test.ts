import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ServiceUnconfiguredError,
  findEnvFile,
  parseEnv,
  requireEmail,
  requireStorage,
  type AppEnv,
} from './env.js';

/** The minimum a developer must supply. Mirrors the REQUIRED block of .env.example. */
const REQUIRED: NodeJS.ProcessEnv = {
  NODE_ENV: 'development',
  APP_URL: 'http://localhost:5173',
  CORS_ORIGINS: 'http://localhost:5173',
  DATABASE_URL: 'postgresql://fleetflow:fleetflow@localhost:5432/fleetflow',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'dev-only-insecure-secret-replace-me-32ch',
};

const STORAGE: NodeJS.ProcessEnv = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  SUPABASE_BUCKET: 'fleetflow',
};

const EMAIL: NodeJS.ProcessEnv = {
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '587',
  SMTP_USER: 'mailer',
  SMTP_PASSWORD: 'secret',
  SMTP_FROM: 'FleetFlow <notifications@example.com>',
  SMTP_SECURE: 'false',
};

function expectOk(source: NodeJS.ProcessEnv): AppEnv {
  const result = parseEnv(source);
  if (!result.ok) {
    throw new Error(`Expected a valid environment, got: ${result.errors.join('; ')}`);
  }
  return result.env;
}

function expectErrors(source: NodeJS.ProcessEnv): string[] {
  const result = parseEnv(source);
  if (result.ok) throw new Error('Expected the environment to be rejected');
  return result.errors;
}

describe('required tier', () => {
  it('accepts the documented minimum and applies defaults', () => {
    const env = expectOk(REQUIRED);
    expect(env.port).toBe(4000);
    expect(env.logLevel).toBe('info');
    expect(env.accessTokenTtlMinutes).toBe(15);
    expect(env.refreshTokenTtlDays).toBe(7);
    expect(env.corsOrigins).toEqual(['http://localhost:5173']);
  });

  it.each(['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET', 'APP_URL'])(
    'refuses to start without %s',
    (key) => {
      const source = { ...REQUIRED };
      delete source[key];
      expect(expectErrors(source).join('\n')).toContain(key);
    },
  );

  it('rejects a JWT secret shorter than 32 characters', () => {
    expect(expectErrors({ ...REQUIRED, JWT_SECRET: 'too-short' }).join('\n')).toContain(
      'at least 32 characters',
    );
  });

  it('rejects a database URL that is not postgres', () => {
    expect(expectErrors({ ...REQUIRED, DATABASE_URL: 'mysql://localhost/x' })).not.toHaveLength(0);
  });

  it('splits and trims a multi-origin CORS list', () => {
    const env = expectOk({ ...REQUIRED, CORS_ORIGINS: 'http://a.test , http://b.test,' });
    expect(env.corsOrigins).toEqual(['http://a.test', 'http://b.test']);
  });
});

describe('feature tier — development', () => {
  it('boots with storage and email empty, and reports them unconfigured', () => {
    const result = parseEnv({
      ...REQUIRED,
      SUPABASE_URL: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      SUPABASE_BUCKET: '',
      SMTP_HOST: '',
      SMTP_PORT: '',
      SMTP_USER: '',
      SMTP_PASSWORD: '',
      SMTP_FROM: '',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.env.storage).toBeNull();
    expect(result.env.email).toBeNull();
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.join('\n')).toContain('SERVICE_UNCONFIGURED');
  });

  it('parses a fully configured feature block', () => {
    const env = expectOk({ ...REQUIRED, ...STORAGE, ...EMAIL });
    expect(env.storage).toEqual({
      url: 'https://project.supabase.co',
      serviceRoleKey: 'service-role-key',
      bucket: 'fleetflow',
    });
    expect(env.email?.port).toBe(587);
    expect(env.email?.secure).toBe(false);
  });

  it('treats whitespace as absent, not as a value', () => {
    const env = expectOk({ ...REQUIRED, SMTP_HOST: '   ', SMTP_PORT: '  ' });
    expect(env.email).toBeNull();
  });
});

describe('feature tier — partial configuration is always fatal', () => {
  it('rejects SMTP with a missing sender, even in development', () => {
    const errors = expectErrors({ ...REQUIRED, ...EMAIL, SMTP_FROM: '' }).join('\n');
    expect(errors).toContain('partially configured');
    expect(errors).toContain('SMTP_FROM');
  });

  it('rejects storage with a missing bucket', () => {
    const errors = expectErrors({ ...REQUIRED, ...STORAGE, SUPABASE_BUCKET: '' }).join('\n');
    expect(errors).toContain('partially configured');
    expect(errors).toContain('SUPABASE_BUCKET');
  });
});

describe('feature tier — production', () => {
  const PROD = { ...REQUIRED, NODE_ENV: 'production' };

  it('refuses to start with an unconfigured mailer', () => {
    const errors = expectErrors(PROD).join('\n');
    expect(errors).toContain('email: required in production');
    expect(errors).toContain('storage: required in production');
  });

  it('starts when every feature is configured', () => {
    const env = expectOk({ ...PROD, ...STORAGE, ...EMAIL });
    expect(env.isProduction).toBe(true);
    expect(env.storage).not.toBeNull();
    expect(env.email).not.toBeNull();
  });
});

describe('locating the .env file', () => {
  // Regression cover for a real defect: dotenv resolves `.env` against
  // process.cwd(), and `npm run dev:api` runs with cwd=apps/api. The root .env
  // was invisible from there, so the documented dev command could not start.
  const roots: string[] = [];

  function makeFakeRepo(options: { withEnv: boolean }): string {
    const root = mkdtempSync(path.join(tmpdir(), 'fleetflow-env-'));
    roots.push(root);
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'fake', workspaces: ['apps/*'] }),
    );
    if (options.withEnv) {
      writeFileSync(path.join(root, '.env'), 'DATABASE_URL=postgresql://x\n');
    }
    mkdirSync(path.join(root, 'apps', 'api', 'src', 'platform'), { recursive: true });
    return root;
  }

  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  it('finds the root .env when started from the api package directory', () => {
    const root = makeFakeRepo({ withEnv: true });
    const found = findEnvFile([path.join(root, 'apps', 'api')]);
    expect(found).toBe(path.join(root, '.env'));
  });

  it('finds it from a deeply nested directory too', () => {
    const root = makeFakeRepo({ withEnv: true });
    const found = findEnvFile([path.join(root, 'apps', 'api', 'src', 'platform')]);
    expect(found).toBe(path.join(root, '.env'));
  });

  it('returns undefined rather than escaping the monorepo root', () => {
    // The temp directory's ancestors are outside the project. A .env up there
    // must never be adopted — the walk stops at the workspaces manifest.
    const root = makeFakeRepo({ withEnv: false });
    expect(findEnvFile([path.join(root, 'apps', 'api')])).toBeUndefined();
  });

  it('prefers a package-local .env over the root one', () => {
    const root = makeFakeRepo({ withEnv: true });
    const local = path.join(root, 'apps', 'api', '.env');
    writeFileSync(local, 'DATABASE_URL=postgresql://local\n');
    expect(findEnvFile([path.join(root, 'apps', 'api')])).toBe(local);
  });
});

describe('feature gates', () => {
  it('throws a 503-mapped error naming the missing variables', () => {
    const env = expectOk(REQUIRED);

    expect(() => requireEmail(env)).toThrow(ServiceUnconfiguredError);
    expect(() => requireStorage(env)).toThrow(ServiceUnconfiguredError);

    try {
      requireEmail(env);
    } catch (error) {
      const e = error as ServiceUnconfiguredError;
      expect(e.code).toBe('SERVICE_UNCONFIGURED');
      expect(e.feature).toBe('email');
      expect(e.missing).toContain('SMTP_HOST');
      expect(e.message).toContain('SMTP_FROM');
    }
  });

  it('returns the config when the feature is configured', () => {
    const env = expectOk({ ...REQUIRED, ...STORAGE, ...EMAIL });
    expect(requireStorage(env).bucket).toBe('fleetflow');
    expect(requireEmail(env).host).toBe('smtp.example.com');
  });
});
