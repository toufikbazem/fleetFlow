/**
 * Document persistence — FF-602, FF-603.
 *
 * **Why the list is raw SQL.**
 *
 * DOC-05's status depends on `expiry_date` compared against
 * `COALESCE(document.notice_days, document_type.default_notice_days)` — a value
 * that lives in a different row for every document. Prisma cannot express
 * "column minus another table's column, compared to today", so filtering by
 * status through the query builder would mean fetching everything and filtering
 * in memory: pagination would be wrong, totals would be wrong, and the
 * expiring-documents report would silently miss rows past the first page.
 *
 * So the predicate is written where it belongs. The `CASE` below is the single
 * definition used for filtering, and it matches `deriveDocumentStatus` in the
 * shared package, which is what the client renders from.
 */

import {
  deriveDocumentStatus,
  daysUntil,
  type Document,
  type DocumentListQuery,
} from '@fleetflow/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../../platform/db.js';
import { vehicleScope, type CallerScope } from '../../platform/scope.js';

/** The status expression. Defined once; used by both the filter and the select. */
const STATUS_SQL = Prisma.sql`
  CASE
    WHEN d.expiry_date < CURRENT_DATE THEN 'EXPIRED'
    WHEN d.expiry_date - COALESCE(d.notice_days, dt.default_notice_days) <= CURRENT_DATE
      THEN 'EXPIRING_SOON'
    ELSE 'VALID'
  END
`;

interface DocumentRow {
  id: string;
  vehicle_id: string;
  plate: string;
  make: string;
  model: string;
  document_type_id: string;
  type_code: string;
  type_label: string;
  reference_no: string | null;
  issue_date: Date | null;
  expiry_date: Date;
  notice_days: number | null;
  effective_notice_days: number;
  status: 'VALID' | 'EXPIRING_SOON' | 'EXPIRED';
  notes: string | null;
  attachment_count: bigint;
  created_at: Date;
}

function dateOnly(value: Date | null): string | null {
  return value ? (value.toISOString().split('T')[0] ?? null) : null;
}

function toDocument(row: DocumentRow): Document {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    plate: row.plate,
    make: row.make,
    model: row.model,
    documentTypeId: row.document_type_id,
    typeCode: row.type_code,
    typeLabel: row.type_label,
    referenceNo: row.reference_no,
    issueDate: dateOnly(row.issue_date),
    expiryDate: dateOnly(row.expiry_date) ?? '',
    noticeDays: row.notice_days,
    effectiveNoticeDays: row.effective_notice_days,
    status: row.status,
    daysUntilExpiry: daysUntil(row.expiry_date),
    notes: row.notes,
    attachmentCount: Number(row.attachment_count),
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * Restricts the query to the vehicles the caller may see.
 *
 * The scope resolvers return Prisma `where` objects, which cannot be dropped
 * into raw SQL — so the vehicle ids are resolved first and passed as a list.
 * For an administrator this is skipped entirely rather than materialising every
 * id in the fleet.
 */
async function scopeClause(caller: CallerScope): Promise<Prisma.Sql> {
  if (caller.scope === 'all') return Prisma.sql`TRUE`;

  const where = await vehicleScope(caller);
  const vehicles = await prisma.vehicle.findMany({ where, select: { id: true } });
  const ids = vehicles.map((vehicle) => vehicle.id);

  // No reachable vehicles means no reachable documents — fail closed.
  if (ids.length === 0) return Prisma.sql`FALSE`;

  // `= ANY(…::uuid[])` rather than `IN (…)`: Prisma binds parameters as text,
  // and Postgres has no uuid = text operator, so an uncast IN list fails with
  // 42883 at runtime. The cast is on the array, applied once.
  return Prisma.sql`d.vehicle_id = ANY(${ids}::uuid[])`;
}

export async function listDocuments(
  query: DocumentListQuery,
  caller: CallerScope,
): Promise<{ rows: Document[]; total: number }> {
  const conditions: Prisma.Sql[] = [
    // Soft delete is applied by hand here: the Prisma extension cannot reach a
    // raw query, which is exactly the kind of gap it exists to prevent.
    Prisma.sql`d.deleted_at IS NULL`,
    Prisma.sql`v.deleted_at IS NULL`,
    await scopeClause(caller),
  ];

  // VEH-06's acceptance says archiving removes a vehicle from operational lists.
  // Its paperwork is part of that: a sold van's lapsed insurance is not a
  // compliance problem, and counting it makes the expiring-documents figure grow
  // for ever as vehicles retire. History stays reachable — the vehicle's own
  // document tab passes `vehicleId`, and reports read across archived vehicles.
  if (!query.includeArchived && !query.vehicleId) {
    conditions.push(Prisma.sql`v.status <> 'ARCHIVED'`);
  }

  if (query.vehicleId) conditions.push(Prisma.sql`d.vehicle_id = ${query.vehicleId}::uuid`);
  if (query.documentTypeId) {
    conditions.push(Prisma.sql`d.document_type_id = ${query.documentTypeId}::uuid`);
  }
  if (query.status) conditions.push(Prisma.sql`${STATUS_SQL} = ${query.status}`);
  if (query.expiringWithinDays !== undefined) {
    conditions.push(Prisma.sql`d.expiry_date <= CURRENT_DATE + ${query.expiringWithinDays}::int`);
  }
  if (query.q) {
    const like = `%${query.q}%`;
    conditions.push(
      Prisma.sql`(v.plate ILIKE ${like} OR d.reference_no ILIKE ${like} OR dt.label ILIKE ${like})`,
    );
  }

  const where = Prisma.join(conditions, ' AND ');

  // Expiring soonest first: the order in which someone has to act on them.
  const orderBy =
    query.sort === 'expiryDate:desc'
      ? Prisma.sql`d.expiry_date DESC`
      : Prisma.sql`d.expiry_date ASC`;

  const offset = (query.page - 1) * query.pageSize;

  const rows = await prisma.$queryRaw<DocumentRow[]>`
    SELECT
      d.id,
      d.vehicle_id,
      v.plate,
      v.make,
      v.model,
      d.document_type_id,
      dt.code  AS type_code,
      dt.label AS type_label,
      d.reference_no,
      d.issue_date,
      d.expiry_date,
      d.notice_days,
      COALESCE(d.notice_days, dt.default_notice_days) AS effective_notice_days,
      ${STATUS_SQL} AS status,
      d.notes,
      (
        SELECT COUNT(*) FROM attachments a
        WHERE a.entity_type = 'DOCUMENT'
          AND a.entity_id = d.id
          AND a.upload_state = 'READY'
          AND a.deleted_at IS NULL
      ) AS attachment_count,
      d.created_at
    FROM documents d
    JOIN vehicles v       ON v.id  = d.vehicle_id
    JOIN document_types dt ON dt.id = d.document_type_id
    WHERE ${where}
    ORDER BY ${orderBy}
    LIMIT ${query.pageSize} OFFSET ${offset}
  `;

  const [{ count }] = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*) AS count
    FROM documents d
    JOIN vehicles v       ON v.id  = d.vehicle_id
    JOIN document_types dt ON dt.id = d.document_type_id
    WHERE ${where}
  `;

  return { rows: rows.map(toDocument), total: Number(count) };
}

// ---------------------------------------------------------------------------
// Single-record access, through Prisma
// ---------------------------------------------------------------------------

/**
 * Attachments are polymorphic — `entity_type` + `entity_id`, no foreign key —
 * so Prisma's `_count` cannot reach them and they are counted separately.
 */
const DOCUMENT_SELECT_NO_COUNT = {
  id: true,
  vehicleId: true,
  documentTypeId: true,
  referenceNo: true,
  issueDate: true,
  expiryDate: true,
  noticeDays: true,
  notes: true,
  createdAt: true,
  vehicle: { select: { plate: true, make: true, model: true } },
  documentType: { select: { code: true, label: true, defaultNoticeDays: true } },
} as const;

type SingleRow = Prisma.DocumentGetPayload<{ select: typeof DOCUMENT_SELECT_NO_COUNT }>;

async function toSingleDocument(row: SingleRow): Promise<Document> {
  const attachmentCount = await prisma.attachment.count({
    where: { entityType: 'DOCUMENT', entityId: row.id, uploadState: 'READY' },
  });

  const effectiveNoticeDays = row.noticeDays ?? row.documentType.defaultNoticeDays;

  return {
    id: row.id,
    vehicleId: row.vehicleId,
    plate: row.vehicle.plate,
    make: row.vehicle.make,
    model: row.vehicle.model,
    documentTypeId: row.documentTypeId,
    typeCode: row.documentType.code,
    typeLabel: row.documentType.label,
    referenceNo: row.referenceNo,
    issueDate: dateOnly(row.issueDate),
    expiryDate: dateOnly(row.expiryDate) ?? '',
    noticeDays: row.noticeDays,
    effectiveNoticeDays,
    // The shared helper, so a single record and a list row agree.
    status: deriveDocumentStatus(row.expiryDate, effectiveNoticeDays),
    daysUntilExpiry: daysUntil(row.expiryDate),
    notes: row.notes,
    attachmentCount,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function findDocumentById(id: string, caller: CallerScope): Promise<Document | null> {
  const scope = await vehicleScope(caller);
  const row = await prisma.document.findFirst({
    where: { AND: [{ id }, { vehicle: scope }] },
    select: DOCUMENT_SELECT_NO_COUNT,
  });
  return row ? toSingleDocument(row) : null;
}

export async function createDocument(data: Prisma.DocumentCreateInput): Promise<Document> {
  const row = await prisma.document.create({ data, select: DOCUMENT_SELECT_NO_COUNT });
  return toSingleDocument(row);
}

export async function updateDocument(
  id: string,
  data: Prisma.DocumentUpdateInput,
): Promise<Document> {
  const row = await prisma.document.update({
    where: { id },
    data,
    select: DOCUMENT_SELECT_NO_COUNT,
  });
  return toSingleDocument(row);
}

export async function softDeleteDocument(id: string): Promise<void> {
  await prisma.document.update({ where: { id }, data: { deletedAt: new Date() } });
}
