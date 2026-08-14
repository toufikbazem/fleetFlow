/**
 * Document management — FF-602, FF-603 (DOC-01…06).
 */

import type {
  CreateDocumentRequest,
  CreateDocumentTypeRequest,
  Document,
  DocumentListQuery,
  DocumentType,
  Paginated,
  UpdateDocumentRequest,
} from '@fleetflow/shared';
import { prisma } from '../../platform/db.js';
import { ConflictError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { childLogger } from '../../platform/logger.js';
import { vehicleScope, type CallerScope } from '../../platform/scope.js';
import {
  createDocument,
  findDocumentById,
  listDocuments,
  softDeleteDocument,
  updateDocument,
} from './repository.js';

const log = childLogger('documents');

function toDate(value: string | undefined): Date | undefined {
  return value ? new Date(`${value}T00:00:00.000Z`) : undefined;
}

async function requireDocument(id: string, caller: CallerScope): Promise<Document> {
  const document = await findDocumentById(id, caller);
  if (!document) throw new NotFoundError('Document');
  return document;
}

// ---------------------------------------------------------------------------
// Document types — DOC-06
// ---------------------------------------------------------------------------

export async function listTypes(): Promise<DocumentType[]> {
  return prisma.documentType.findMany({
    where: { isActive: true },
    select: { id: true, code: true, label: true, defaultNoticeDays: true, isActive: true },
    orderBy: { label: 'asc' },
  });
}

export async function createType(input: CreateDocumentTypeRequest): Promise<DocumentType> {
  const type = await prisma.documentType.create({
    data: {
      code: input.code,
      label: input.label,
      defaultNoticeDays: input.defaultNoticeDays,
    },
    select: { id: true, code: true, label: true, defaultNoticeDays: true, isActive: true },
  });
  log.info({ documentTypeId: type.id, code: type.code }, 'Document type created');
  return type;
}

/**
 * Deactivates a type rather than deleting it.
 *
 * Documents already filed against it keep their label and their notice period.
 * Removing the row would orphan them — and `documents.document_type_id` is a
 * RESTRICT foreign key precisely so that cannot happen by accident.
 */
export async function deactivateType(id: string): Promise<void> {
  const inUse = await prisma.document.count({ where: { documentTypeId: id } });
  await prisma.documentType.update({ where: { id }, data: { isActive: false } });
  log.info({ documentTypeId: id, documentsAffected: inUse }, 'Document type deactivated');
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export async function list(
  query: DocumentListQuery,
  caller: CallerScope,
): Promise<Paginated<Document>> {
  const { rows, total } = await listDocuments(query, caller);
  return { data: rows, page: query.page, pageSize: query.pageSize, total };
}

export async function getById(id: string, caller: CallerScope): Promise<Document> {
  return requireDocument(id, caller);
}

export async function create(input: CreateDocumentRequest, caller: CallerScope): Promise<Document> {
  // The vehicle is named in the body, so a `where` fragment cannot constrain
  // it — the scope has to be checked explicitly, as with damages and jobs.
  const scope = await vehicleScope(caller);
  const vehicle = await prisma.vehicle.findFirst({
    where: { AND: [scope, { id: input.vehicleId }] },
    select: { id: true },
  });
  if (!vehicle) {
    throw new ValidationError([{ path: 'body.vehicleId', message: 'No such vehicle.' }]);
  }

  const type = await prisma.documentType.findUnique({
    where: { id: input.documentTypeId },
    select: { id: true, isActive: true, label: true },
  });
  if (!type) {
    throw new ValidationError([{ path: 'body.documentTypeId', message: 'No such document type.' }]);
  }
  if (!type.isActive) {
    throw new ConflictError(`"${type.label}" is no longer offered as a document type.`);
  }

  const document = await createDocument({
    vehicle: { connect: { id: input.vehicleId } },
    documentType: { connect: { id: input.documentTypeId } },
    referenceNo: input.referenceNo ?? null,
    issueDate: toDate(input.issueDate) ?? null,
    expiryDate: toDate(input.expiryDate) as Date,
    // Null means "use the type's default" — the override is deliberately
    // absent rather than copied, so changing the default reaches every
    // document that never set its own.
    noticeDays: input.noticeDays ?? null,
    notes: input.notes ?? null,
  });

  log.info(
    { documentId: document.id, vehicleId: input.vehicleId, expiry: document.expiryDate },
    'Document created',
  );
  return document;
}

export async function update(
  id: string,
  input: UpdateDocumentRequest,
  caller: CallerScope,
): Promise<Document> {
  await requireDocument(id, caller);

  if (input.documentTypeId) {
    const type = await prisma.documentType.findUnique({ where: { id: input.documentTypeId } });
    if (!type) {
      throw new ValidationError([
        { path: 'body.documentTypeId', message: 'No such document type.' },
      ]);
    }
  }

  return updateDocument(id, {
    ...(input.documentTypeId ? { documentType: { connect: { id: input.documentTypeId } } } : {}),
    ...(input.referenceNo !== undefined ? { referenceNo: input.referenceNo } : {}),
    ...(input.issueDate !== undefined ? { issueDate: toDate(input.issueDate) } : {}),
    ...(input.expiryDate !== undefined ? { expiryDate: toDate(input.expiryDate) } : {}),
    // Explicit null clears the override and returns the document to the type's
    // default; undefined leaves it untouched.
    ...(input.noticeDays !== undefined ? { noticeDays: input.noticeDays } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
  });
}

/**
 * DOC-01 delete, under Q6 soft delete.
 *
 * The row is retained so an expired-document audit can still answer what was
 * on file and when. Attachments are left alone: they are removed individually,
 * and sweeping them here would delete files a soft-deleted record still refers to.
 */
export async function remove(id: string, caller: CallerScope): Promise<void> {
  await requireDocument(id, caller);
  await softDeleteDocument(id);
  log.info({ documentId: id }, 'Document deleted');
}
