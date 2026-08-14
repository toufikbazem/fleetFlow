/**
 * Document and attachment routes — FF-601, FF-602, FF-603.
 *
 * Attachment endpoints live here because the pipeline is shared: maintenance
 * invoices (MNT-03) and damage photos (DMG-04) call the same three endpoints
 * with a different `entityType`. Authorisation is resolved per entity inside
 * the service, against the module that owns the record.
 */

import {
  createDocumentRequestSchema,
  createDocumentTypeRequestSchema,
  documentListQuerySchema,
  idParamSchema,
  requestUploadRequestSchema,
  updateDocumentRequestSchema,
  type AttachmentListResponse,
  type DocumentListResponse,
  type DocumentResponse,
  type DocumentTypeListResponse,
  type DownloadUrl,
  type UploadTicket,
} from '@fleetflow/shared';
import { Router } from 'express';
import { z } from 'zod';
import { authorize, callerIdentity, callerScope } from '../../platform/middleware/authorize.js';
import { authenticated, requireAuth } from '../../platform/middleware/require-auth.js';
import { body, params, query, validate } from '../../platform/middleware/validate.js';
import { isStorageConfigured } from '../../platform/storage.js';
import {
  confirmUpload,
  deleteAttachment,
  getDownloadUrl,
  listAttachments,
  requestUpload,
} from '../attachments/service.js';
import {
  create,
  createType,
  deactivateType,
  getById,
  list,
  listTypes,
  remove,
  update,
} from './service.js';

export const documentsRouter: Router = Router();

// ---------------------------------------------------------------------------
// Document types — DOC-06
// ---------------------------------------------------------------------------

documentsRouter.get(
  '/document-types',
  requireAuth,
  authorize('documents', 'read'),
  async (_req, res) => {
    const response: DocumentTypeListResponse = { data: await listTypes() };
    res.json(response);
  },
);

documentsRouter.post(
  '/document-types',
  requireAuth,
  authorize('documents', 'create'),
  validate({ body: createDocumentTypeRequestSchema }),
  async (req, res) => {
    res
      .status(201)
      .json({ documentType: await createType(body(createDocumentTypeRequestSchema, req)) });
  },
);

documentsRouter.delete(
  '/document-types/:id',
  requireAuth,
  authorize('documents', 'delete'),
  validate({ params: idParamSchema }),
  async (req, res) => {
    await deactivateType(params(idParamSchema, req).id);
    res.status(204).end();
  },
);

// ---------------------------------------------------------------------------
// Documents — DOC-01…05
// ---------------------------------------------------------------------------

documentsRouter.get(
  '/documents',
  requireAuth,
  authorize('documents', 'read'),
  validate({ query: documentListQuerySchema }),
  async (req, res) => {
    const response: DocumentListResponse = await list(
      query(documentListQuerySchema, req),
      callerScope(req),
    );
    res.json(response);
  },
);

documentsRouter.get(
  '/documents/:id',
  requireAuth,
  authorize('documents', 'read'),
  validate({ params: idParamSchema }),
  async (req, res) => {
    const response: DocumentResponse = {
      document: await getById(params(idParamSchema, req).id, callerScope(req)),
    };
    res.json(response);
  },
);

documentsRouter.post(
  '/documents',
  requireAuth,
  authorize('documents', 'create'),
  validate({ body: createDocumentRequestSchema }),
  async (req, res) => {
    const response: DocumentResponse = {
      document: await create(body(createDocumentRequestSchema, req), callerScope(req)),
    };
    res.status(201).json(response);
  },
);

documentsRouter.patch(
  '/documents/:id',
  requireAuth,
  authorize('documents', 'update'),
  validate({ params: idParamSchema, body: updateDocumentRequestSchema }),
  async (req, res) => {
    const response: DocumentResponse = {
      document: await update(
        params(idParamSchema, req).id,
        body(updateDocumentRequestSchema, req),
        callerScope(req),
      ),
    };
    res.json(response);
  },
);

documentsRouter.delete(
  '/documents/:id',
  requireAuth,
  authorize('documents', 'delete'),
  validate({ params: idParamSchema }),
  async (req, res) => {
    await remove(params(idParamSchema, req).id, callerScope(req));
    res.status(204).end();
  },
);

// ---------------------------------------------------------------------------
// Attachments — FF-601, shared by DOC-02 / MNT-03 / DMG-04
// ---------------------------------------------------------------------------

/**
 * Lets the client ask whether uploading is possible before offering a control
 * that cannot work. Storage is unconfigured until FF-004 supplies credentials,
 * and a disabled button with a reason beats a 503 after the file is chosen.
 */
documentsRouter.get('/attachments/status', requireAuth, (_req, res) => {
  res.json({ configured: isStorageConfigured() });
});

const attachmentQuerySchema = z.object({
  entityType: z.enum(['DOCUMENT', 'MAINTENANCE_OP', 'DAMAGE']),
  entityId: z.string().uuid(),
});

documentsRouter.get(
  '/attachments',
  requireAuth,
  validate({ query: attachmentQuerySchema }),
  async (req, res) => {
    const { entityType, entityId } = query(attachmentQuerySchema, req);
    const response: AttachmentListResponse = {
      data: await listAttachments(entityType, entityId, callerIdentity(req)),
    };
    res.json(response);
  },
);

/** Step one of the upload. Returns a URL the browser PUTs to directly. */
documentsRouter.post(
  '/attachments/upload-url',
  requireAuth,
  validate({ body: requestUploadRequestSchema }),
  async (req, res) => {
    const actor = authenticated(req);
    const ticket: UploadTicket = await requestUpload(
      body(requestUploadRequestSchema, req),
      callerIdentity(req),
      actor.id,
    );
    res.status(201).json(ticket);
  },
);

/** Step two. Verifies the stored object before the attachment becomes usable. */
documentsRouter.post(
  '/attachments/:id/confirm',
  requireAuth,
  validate({ params: idParamSchema }),
  async (req, res) => {
    const attachment = await confirmUpload(params(idParamSchema, req).id, callerIdentity(req));
    res.json({ attachment });
  },
);

documentsRouter.get(
  '/attachments/:id/download-url',
  requireAuth,
  validate({ params: idParamSchema }),
  async (req, res) => {
    const response: DownloadUrl = await getDownloadUrl(
      params(idParamSchema, req).id,
      callerIdentity(req),
    );
    res.json(response);
  },
);

documentsRouter.delete(
  '/attachments/:id',
  requireAuth,
  validate({ params: idParamSchema }),
  async (req, res) => {
    await deleteAttachment(params(idParamSchema, req).id, callerIdentity(req));
    res.status(204).end();
  },
);
