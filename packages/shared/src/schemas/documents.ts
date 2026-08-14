/**
 * Document and attachment contract — DOC-01…06, plus the shared upload
 * pipeline used by MNT-03 and DMG-04.
 */

import { z } from 'zod';
import {
  ATTACHMENT_ENTITIES,
  ATTACHMENT_KINDS,
  DOCUMENT_STATUSES,
  UPLOAD_STATES,
} from '../enums.js';
import {
  dateOnlySchema,
  paginated,
  paginationQuerySchema,
  uuidSchema,
  optionalField,
} from './common.js';

// ---------------------------------------------------------------------------
// Attachments — the pipeline
// ---------------------------------------------------------------------------

export const attachmentSchema = z.object({
  id: uuidSchema,
  entityType: z.enum(ATTACHMENT_ENTITIES),
  entityId: uuidSchema,
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  kind: z.enum(ATTACHMENT_KINDS),
  uploadState: z.enum(UPLOAD_STATES),
  uploadedByName: z.string().nullable(),
  createdAt: z.string(),
});
export type Attachment = z.infer<typeof attachmentSchema>;

export const attachmentListResponseSchema = z.object({ data: z.array(attachmentSchema) });
export type AttachmentListResponse = z.infer<typeof attachmentListResponseSchema>;

/**
 * Step one: the client declares what it intends to upload and receives a URL
 * that lets it write exactly one object. Both declared values are re-checked
 * against the stored object in step two.
 */
export const requestUploadRequestSchema = z.object({
  entityType: z.enum(ATTACHMENT_ENTITIES),
  entityId: uuidSchema,
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(120),
  sizeBytes: z.coerce.number().int().positive(),
  kind: z.enum(ATTACHMENT_KINDS).default('SCAN'),
});
export type RequestUploadRequest = z.infer<typeof requestUploadRequestSchema>;

export const uploadTicketSchema = z.object({
  /** The pending attachment row; it becomes READY only after confirmation. */
  attachmentId: uuidSchema,
  uploadUrl: z.string(),
  token: z.string(),
  objectPath: z.string(),
  bucket: z.string(),
  expiresInSeconds: z.number().int(),
});
export type UploadTicket = z.infer<typeof uploadTicketSchema>;

export const downloadUrlSchema = z.object({
  url: z.string(),
  expiresInSeconds: z.number().int(),
});
export type DownloadUrl = z.infer<typeof downloadUrlSchema>;

// ---------------------------------------------------------------------------
// Document types — DOC-06
// ---------------------------------------------------------------------------

export const documentTypeSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  label: z.string(),
  defaultNoticeDays: z.number().int(),
  isActive: z.boolean(),
});
export type DocumentType = z.infer<typeof documentTypeSchema>;

export const documentTypeListResponseSchema = z.object({ data: z.array(documentTypeSchema) });
export type DocumentTypeListResponse = z.infer<typeof documentTypeListResponseSchema>;

export const createDocumentTypeRequestSchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9_]+$/, 'Use lower-case letters, numbers and underscores'),
  label: z.string().trim().min(1).max(80),
  defaultNoticeDays: z.coerce.number().int().positive().default(30),
});
export type CreateDocumentTypeRequest = z.infer<typeof createDocumentTypeRequestSchema>;

// ---------------------------------------------------------------------------
// Documents — DOC-01…05
// ---------------------------------------------------------------------------

export const documentSchema = z.object({
  id: uuidSchema,
  vehicleId: uuidSchema,
  plate: z.string(),
  make: z.string(),
  model: z.string(),
  documentTypeId: uuidSchema,
  typeCode: z.string(),
  typeLabel: z.string(),
  referenceNo: z.string().nullable(),
  issueDate: z.string().nullable(),
  expiryDate: z.string(),
  /** Per-document override of the type's default (DOC-03). */
  noticeDays: z.number().int().nullable(),
  /** What the override resolves to — the number the reminder actually uses. */
  effectiveNoticeDays: z.number().int(),
  /** DOC-05 — derived, never stored. */
  status: z.enum(DOCUMENT_STATUSES),
  daysUntilExpiry: z.number().int(),
  notes: z.string().nullable(),
  attachmentCount: z.number().int(),
  createdAt: z.string(),
});
export type Document = z.infer<typeof documentSchema>;

export const documentListResponseSchema = paginated(documentSchema);
export type DocumentListResponse = z.infer<typeof documentListResponseSchema>;

export const documentResponseSchema = z.object({ document: documentSchema });
export type DocumentResponse = z.infer<typeof documentResponseSchema>;

export const documentListQuerySchema = paginationQuerySchema.extend({
  vehicleId: uuidSchema.optional(),
  documentTypeId: uuidSchema.optional(),
  /** Filtered in SQL against the effective notice period, not in the client. */
  status: z.enum(DOCUMENT_STATUSES).optional(),
  expiringWithinDays: z.coerce.number().int().positive().max(365).optional(),
  /**
   * Archived vehicles' documents are hidden from the operational list by
   * default, matching VEH-06 and the notification rules. Naming a `vehicleId`
   * overrides this — asking for one vehicle's documents means you want them.
   */
  includeArchived: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});
export type DocumentListQuery = z.infer<typeof documentListQuerySchema>;

export const createDocumentRequestSchema = z
  .object({
    vehicleId: uuidSchema,
    documentTypeId: uuidSchema,
    referenceNo: optionalField(z.string().trim().max(80)),
    issueDate: optionalField(dateOnlySchema),
    expiryDate: dateOnlySchema,
    noticeDays: optionalField(z.coerce.number().int().positive().max(365)),
    notes: optionalField(z.string().trim().max(2000)),
  })
  .refine((value) => !value.issueDate || value.issueDate <= value.expiryDate, {
    message: 'A document cannot expire before it was issued',
    path: ['expiryDate'],
  });
export type CreateDocumentRequest = z.infer<typeof createDocumentRequestSchema>;

export const updateDocumentRequestSchema = z
  .object({
    documentTypeId: optionalField(uuidSchema),
    referenceNo: optionalField(z.string().trim().max(80)),
    issueDate: optionalField(dateOnlySchema),
    expiryDate: optionalField(dateOnlySchema),
    noticeDays: optionalField(z.coerce.number().int().positive().max(365).nullable()),
    notes: optionalField(z.string().trim().max(2000)),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });
export type UpdateDocumentRequest = z.infer<typeof updateDocumentRequestSchema>;
