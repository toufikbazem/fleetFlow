/**
 * Prisma client and the soft-delete query extension — FF-105.
 *
 * Decision Q6 is "soft delete everywhere". That is only trustworthy if it is
 * the default: a rule that each repository must remember to apply is a rule
 * that one repository will eventually forget, and the symptom — deleted
 * vehicles reappearing in a list — surfaces long after the omission.
 *
 * So every read through `prisma` is filtered automatically. Seeing deleted rows
 * requires saying so, either by naming `deletedAt` in the `where` yourself or by
 * going through `withDeleted()`. Both are visible at the call site during review.
 *
 * The set of soft-deletable models is read from Prisma's DMMF at runtime rather
 * than hardcoded, so a model added later with a `deletedAt` column is covered
 * the moment it exists.
 */

import { Prisma, PrismaClient } from '@prisma/client';
import { loadEnv } from './env.js';

const SOFT_DELETE_FIELD = 'deletedAt';

/** Read operations that accept a `where` and must therefore be filtered. */
const FILTERED_OPERATIONS = [
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
] as const;

// ---------------------------------------------------------------------------
// Model metadata, derived from the generated schema
// ---------------------------------------------------------------------------

interface RelationInfo {
  /** Target model name. */
  type: string;
  /** Only list relations accept a nested `where`. */
  isList: boolean;
}

const softDeleteModels = new Set<string>();
const relationsByModel = new Map<string, Map<string, RelationInfo>>();

for (const model of Prisma.dmmf.datamodel.models) {
  if (model.fields.some((field) => field.name === SOFT_DELETE_FIELD)) {
    softDeleteModels.add(model.name);
  }
  const relations = new Map<string, RelationInfo>();
  for (const field of model.fields) {
    if (field.kind === 'object') {
      relations.set(field.name, { type: field.type, isList: field.isList });
    }
  }
  relationsByModel.set(model.name, relations);
}

/** Models carrying a `deleted_at` column. Exported for tests and diagnostics. */
export const SOFT_DELETE_MODELS: ReadonlySet<string> = softDeleteModels;

export function isSoftDeletable(model: string | undefined): boolean {
  return model !== undefined && softDeleteModels.has(model);
}

// ---------------------------------------------------------------------------
// Filter injection
// ---------------------------------------------------------------------------

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * True when the caller has already said something about `deletedAt`.
 *
 * This is the deliberate escape hatch for "show me only the deleted ones"
 * (`where: { deletedAt: { not: null } }`) and for reports that legitimately span
 * both. An explicit mention always wins over the automatic filter.
 */
function callerHandlesDeleted(where: unknown): boolean {
  if (!isRecord(where)) return false;
  if (SOFT_DELETE_FIELD in where) return true;
  // Boolean combinators can carry the condition further down.
  for (const key of ['AND', 'OR', 'NOT'] as const) {
    const branch = where[key];
    if (Array.isArray(branch)) {
      if (branch.some((clause) => callerHandlesDeleted(clause))) return true;
    } else if (isRecord(branch) && callerHandlesDeleted(branch)) {
      return true;
    }
  }
  return false;
}

function withNotDeleted(where: unknown): UnknownRecord {
  const base = isRecord(where) ? where : {};
  if (callerHandlesDeleted(base)) return base;
  return { ...base, [SOFT_DELETE_FIELD]: null };
}

/**
 * Applies the filter to nested reads reached through `include` / `select`.
 *
 * Without this, `vehicle.findMany({ include: { documents: true } })` would
 * return the vehicle's *deleted* documents alongside its live ones — the
 * top-level filter says nothing about relations.
 *
 * Limitation: Prisma accepts a nested `where` only on **list** relations. A
 * to-one relation (`document.vehicle`) cannot be filtered here, so a soft-deleted
 * parent still resolves. Services that follow a to-one link into a possibly
 * deleted record must check `deletedAt` themselves.
 */
function filterNested(modelName: string, node: unknown): unknown {
  if (!isRecord(node)) return node;

  const relations = relationsByModel.get(modelName);
  if (!relations) return node;

  const result: UnknownRecord = { ...node };

  for (const [key, value] of Object.entries(node)) {
    const relation = relations.get(key);
    if (!relation) continue;

    const targetIsSoftDeletable = softDeleteModels.has(relation.type);

    // `include: { documents: true }` — expand to an args object so a where fits.
    if (value === true) {
      if (targetIsSoftDeletable && relation.isList) {
        result[key] = { where: { [SOFT_DELETE_FIELD]: null } };
      }
      continue;
    }

    if (!isRecord(value)) continue;

    const nested: UnknownRecord = { ...value };

    if (targetIsSoftDeletable && relation.isList) {
      nested['where'] = withNotDeleted(nested['where']);
    }

    // Recurse: relations of relations need the same treatment.
    if ('include' in nested) nested['include'] = filterNested(relation.type, nested['include']);
    if ('select' in nested) nested['select'] = filterNested(relation.type, nested['select']);

    result[key] = nested;
  }

  return result;
}

// ---------------------------------------------------------------------------
// The extension
// ---------------------------------------------------------------------------

export const softDeleteExtension = Prisma.defineExtension({
  name: 'soft-delete',
  query: {
    $allModels: {
      // `model` is always defined here: $allModels never covers raw queries.
      $allOperations({ model, operation, args, query }) {
        if (!(FILTERED_OPERATIONS as readonly string[]).includes(operation)) {
          return query(args);
        }
        // NB: the root model being non-soft-deletable does NOT let us skip this.
        // `vehicleType.findMany({ include: { vehicles: true } })` has a root
        // without deleted_at and children with it — an early return here was a
        // real hole, caught by the deep-nesting test.

        // `args` is a union of every model's argument type. The extension works
        // structurally on `where` / `include` / `select`, which every member of
        // that union either has or tolerates, so it is handled as a record and
        // handed back to `query` unchanged in shape.
        const incoming: UnknownRecord = isRecord(args) ? (args as UnknownRecord) : {};
        const next: UnknownRecord = { ...incoming };

        if (isSoftDeletable(model)) {
          next['where'] = withNotDeleted(incoming['where']);
        }

        if ('include' in next) next['include'] = filterNested(model, next['include']);
        if ('select' in next) next['select'] = filterNested(model, next['select']);

        return query(next as typeof args);
      },
    },
  },
});

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const env = loadEnv();

const baseClient = new PrismaClient({
  datasourceUrl: env.databaseUrl,
  log: env.isProduction ? ['warn', 'error'] : ['warn', 'error'],
});

/**
 * The client every service and repository uses. Reads exclude soft-deleted rows.
 */
export const prisma = baseClient.$extends(softDeleteExtension);

export type ExtendedPrismaClient = typeof prisma;

/**
 * The unfiltered client — soft-deleted rows included.
 *
 * Legitimate uses are narrow and auditable: historical reports that must still
 * count an archived vehicle's costs, the audit trail, and administrative purge.
 * It is a function rather than a bare export so the intent reads at the call
 * site: `withDeleted().vehicle.findMany(...)`.
 */
export function withDeleted(): PrismaClient {
  return baseClient;
}

export async function disconnectDb(): Promise<void> {
  await baseClient.$disconnect();
}
