/**
 * Attachment lifecycle — FF-601.
 *
 * Polymorphic by design: documents, maintenance invoices and damage photos all
 * come through here. There is no foreign key on `entity_id`, so this layer is
 * what makes sure the target exists and the caller may reach it — a check the
 * database cannot do for a column that points at three different tables.
 */

import type { Attachment, AttachmentEntity, RequestUploadRequest } from '@fleetflow/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../../platform/db.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { childLogger } from '../../platform/logger.js';
import {
  assertUploadAllowed,
  buildObjectPath,
  createSignedDownload,
  createSignedUpload,
  deleteStoredObject,
  describeStoredObject,
} from '../../platform/storage.js';
import { can } from '@fleetflow/shared';
import {
  damageScope,
  documentScope,
  maintenanceScope,
  type CallerIdentity,
  type CallerScope,
} from '../../platform/scope.js';

const log = childLogger('attachments');

const ATTACHMENT_SELECT = {
  id: true,
  entityType: true,
  entityId: true,
  bucket: true,
  objectPath: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  kind: true,
  uploadState: true,
  createdAt: true,
  uploadedBy: { select: { name: true } },
} as const;

type AttachmentRow = Prisma.AttachmentGetPayload<{ select: typeof ATTACHMENT_SELECT }>;

function toAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    kind: row.kind,
    uploadState: row.uploadState,
    uploadedByName: row.uploadedBy?.name ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Which permission module governs each attachable thing. */
const MODULE_FOR_ENTITY = {
  DOCUMENT: 'documents',
  MAINTENANCE_OP: 'maintenance',
  DAMAGE: 'damages',
} as const;

/**
 * Confirms the target exists and the caller may reach it.
 *
 * Attaching a file is a write against the parent record, so the check is the
 * parent's own scope — a driver may photograph a damage on their own vehicle
 * (DMG-04) and nothing else. Without this, `entity_id` would be an unvalidated
 * pointer and an attachment could be hung off any record in the system.
 */
async function assertCanAttach(
  entityType: AttachmentEntity,
  entityId: string,
  caller: CallerIdentity,
  action: 'create' | 'read',
): Promise<void> {
  // This is where authorisation actually happens for attachments. The routes
  // carry no `authorize()` because the governing module is not known until the
  // request body has been read — so the matrix is consulted here instead,
  // against the module that owns the record being attached to.
  const module = MODULE_FOR_ENTITY[entityType];
  const decision = can(caller.role, module, action);
  if (!decision.allowed) throw new ForbiddenError();

  const scopedCaller: CallerScope = { ...caller, scope: decision.scope };

  const exists = await (async () => {
    switch (entityType) {
      case 'DOCUMENT': {
        const where = await documentScope(scopedCaller);
        return prisma.document.findFirst({
          where: { AND: [where, { id: entityId }] },
          select: { id: true },
        });
      }
      case 'MAINTENANCE_OP': {
        const where = await maintenanceScope(scopedCaller);
        return prisma.maintenanceOp.findFirst({
          where: { AND: [where, { id: entityId }] },
          select: { id: true },
        });
      }
      case 'DAMAGE': {
        const where = await damageScope(scopedCaller);
        return prisma.damage.findFirst({
          where: { AND: [where, { id: entityId }] },
          select: { id: true },
        });
      }
    }
  })();

  // Out of scope and non-existent answer identically — the same rule the rest
  // of the API follows.
  if (!exists) throw new NotFoundError('Record');
}

// ---------------------------------------------------------------------------
// Upload — two steps
// ---------------------------------------------------------------------------

export interface UploadTicketResult {
  attachmentId: string;
  uploadUrl: string;
  token: string;
  objectPath: string;
  bucket: string;
  expiresInSeconds: number;
}

/**
 * Step one. Validates the claim, reserves a path, and writes a PENDING row.
 *
 * The row exists before the file does so that an upload which is started and
 * abandoned leaves a trace: it can be swept, and it is never mistaken for a
 * usable attachment because nothing outside this flow reads PENDING rows.
 */
export async function requestUpload(
  input: RequestUploadRequest,
  caller: CallerIdentity,
  uploadedById: string,
): Promise<UploadTicketResult> {
  await assertCanAttach(input.entityType, input.entityId, caller, 'create');

  // Throws before anything is reserved — a rejected type never gets a URL.
  assertUploadAllowed({
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    kind: input.kind,
  });

  const objectPath = buildObjectPath(input.entityType, input.entityId, input.fileName);
  const signed = await createSignedUpload(objectPath);

  const attachment = await prisma.attachment.create({
    data: {
      entityType: input.entityType,
      entityId: input.entityId,
      bucket: signed.bucket,
      objectPath: signed.objectPath,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      kind: input.kind,
      uploadState: 'PENDING',
      uploadedById,
    },
    select: { id: true },
  });

  log.info(
    { attachmentId: attachment.id, entityType: input.entityType, entityId: input.entityId },
    'Upload ticket issued',
  );

  return {
    attachmentId: attachment.id,
    uploadUrl: signed.uploadUrl,
    token: signed.token,
    objectPath: signed.objectPath,
    bucket: signed.bucket,
    expiresInSeconds: signed.expiresInSeconds,
  };
}

/**
 * Step two. Verifies what actually landed, then marks the row READY.
 *
 * This is where the client's declared size and type stop being taken on trust.
 * A file that never arrived, or one twice the size it claimed, is rejected and
 * the pending row destroyed — otherwise the attachment would look usable and
 * fail only when somebody tried to open it, weeks later.
 */
export async function confirmUpload(
  attachmentId: string,
  caller: CallerIdentity,
): Promise<Attachment> {
  const row = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    select: ATTACHMENT_SELECT,
  });
  if (!row) throw new NotFoundError('Attachment');

  await assertCanAttach(row.entityType, row.entityId, caller, 'create');

  if (row.uploadState === 'READY') return toAttachment(row);

  const stored = await describeStoredObject(row.objectPath);

  if (!stored) {
    await prisma.attachment.delete({ where: { id: attachmentId } });
    throw new ValidationError([], 'The file was not uploaded. Please try again.');
  }

  // Re-checked against what is really there, not what was promised.
  try {
    assertUploadAllowed({
      mimeType: stored.mimeType ?? row.mimeType,
      sizeBytes: stored.sizeBytes,
      kind: row.kind,
    });
  } catch (error) {
    await deleteStoredObject(row.objectPath);
    await prisma.attachment.delete({ where: { id: attachmentId } });
    throw error;
  }

  const updated = await prisma.attachment.update({
    where: { id: attachmentId },
    data: {
      uploadState: 'READY',
      // The stored object is the authority on both.
      sizeBytes: stored.sizeBytes,
      ...(stored.mimeType ? { mimeType: stored.mimeType } : {}),
    },
    select: ATTACHMENT_SELECT,
  });

  log.info({ attachmentId, sizeBytes: stored.sizeBytes }, 'Upload confirmed');
  return toAttachment(updated);
}

// ---------------------------------------------------------------------------
// Read and delete
// ---------------------------------------------------------------------------

export async function listAttachments(
  entityType: AttachmentEntity,
  entityId: string,
  caller: CallerIdentity,
): Promise<Attachment[]> {
  await assertCanAttach(entityType, entityId, caller, 'read');

  const rows = await prisma.attachment.findMany({
    // PENDING rows are half-finished uploads; showing them would offer the user
    // a file that does not exist.
    where: { entityType, entityId, uploadState: 'READY' },
    select: ATTACHMENT_SELECT,
    orderBy: { createdAt: 'desc' },
  });

  return rows.map(toAttachment);
}

export async function getDownloadUrl(
  attachmentId: string,
  caller: CallerIdentity,
): Promise<{ url: string; expiresInSeconds: number }> {
  const row = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    select: ATTACHMENT_SELECT,
  });
  if (!row || row.uploadState !== 'READY') throw new NotFoundError('Attachment');

  // Authorised on every request: the URL is short-lived precisely because the
  // check happens here and not at the bucket.
  await assertCanAttach(row.entityType, row.entityId, caller, 'read');

  return createSignedDownload(row.objectPath, row.fileName);
}

/**
 * Removes an attachment and its object.
 *
 * A hard delete, unlike the rest of the system: a soft-deleted attachment would
 * keep paying for storage indefinitely while being invisible, and the file
 * itself is not a business record — the document, job or damage it belonged to
 * is, and that keeps its own soft-delete history.
 */
export async function deleteAttachment(
  attachmentId: string,
  caller: CallerIdentity,
): Promise<void> {
  const row = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    select: ATTACHMENT_SELECT,
  });
  if (!row) throw new NotFoundError('Attachment');

  await assertCanAttach(row.entityType, row.entityId, caller, 'create');

  await prisma.attachment.delete({ where: { id: attachmentId } });
  await deleteStoredObject(row.objectPath);

  log.info({ attachmentId }, 'Attachment deleted');
}
