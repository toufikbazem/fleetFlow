/**
 * File storage — FF-601.
 *
 * Serves DOC-02 (document scans), MNT-03 (maintenance invoices) and DMG-04
 * (damage photos) through one pipeline.
 *
 * **Files never pass through this process.** The client asks for a signed
 * upload URL, uploads straight to Supabase Storage, then confirms. Three
 * reasons, in order of importance:
 *
 *   1. a 20 MB scan does not occupy the Node event loop while it transfers
 *   2. the API never holds user file content in memory, so a malformed upload
 *      cannot exhaust it
 *   3. the bucket stays private — every read is a short-lived signed URL issued
 *      after an authorisation check, so a leaked link expires rather than
 *      exposing a fleet's insurance documents indefinitely
 *
 * The size and type declared when requesting the URL are *claims*. They are
 * checked again against the stored object before the attachment is marked
 * READY, because a client that lies about either is exactly the case this
 * guards against.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  ALLOWED_UPLOAD_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  type AttachmentKind,
} from '@fleetflow/shared';
import { randomUUID } from 'node:crypto';
import { ServiceUnconfiguredError, loadEnv, requireStorage } from './env.js';
import { childLogger } from './logger.js';
import { ValidationError } from './errors.js';

const env = loadEnv();
const log = childLogger('storage');

/** Long enough to upload a 20 MB scan on a slow connection, short enough to matter. */
const UPLOAD_URL_TTL_SECONDS = 15 * 60;
/** Downloads are opened immediately; a short life limits the damage of a leak. */
const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

let client: SupabaseClient | undefined;

function getClient(): SupabaseClient {
  const config = requireStorage(env);
  client ??= createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export function isStorageConfigured(): boolean {
  return env.storage !== null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const ALLOWED = new Set<string>(ALLOWED_UPLOAD_MIME_TYPES);

/** Invoices are documents, not photographs — a JPEG of a receipt is not one. */
const KIND_MIME_TYPES: Record<AttachmentKind, readonly string[]> = {
  SCAN: ALLOWED_UPLOAD_MIME_TYPES,
  INVOICE: ['application/pdf', 'image/jpeg', 'image/png'],
  PHOTO: ['image/jpeg', 'image/png', 'image/webp', 'image/heic'],
};

export function assertUploadAllowed(input: {
  mimeType: string;
  sizeBytes: number;
  kind: AttachmentKind;
}): void {
  if (!ALLOWED.has(input.mimeType)) {
    throw new ValidationError(
      [{ path: 'body.mimeType', message: `${input.mimeType} files cannot be uploaded.` }],
      'That file type is not accepted.',
    );
  }

  if (!KIND_MIME_TYPES[input.kind].includes(input.mimeType)) {
    throw new ValidationError([
      {
        path: 'body.mimeType',
        message: `A ${input.kind.toLowerCase()} cannot be a ${input.mimeType} file.`,
      },
    ]);
  }

  if (input.sizeBytes <= 0) {
    throw new ValidationError([{ path: 'body.sizeBytes', message: 'The file is empty.' }]);
  }

  if (input.sizeBytes > MAX_UPLOAD_BYTES) {
    const limitMb = Math.round(MAX_UPLOAD_BYTES / 1024 / 1024);
    throw new ValidationError(
      [{ path: 'body.sizeBytes', message: `Files must be ${limitMb} MB or smaller.` }],
      'That file is too large.',
    );
  }
}

/**
 * Builds the object path.
 *
 * The original filename never becomes the path: it is user input, may contain
 * traversal sequences or characters the bucket rejects, and two people
 * uploading "scan.pdf" must not collide. The real name is kept as metadata on
 * the attachment row and restored on download.
 */
export function buildObjectPath(entityType: string, entityId: string, fileName: string): string {
  const extension = fileName.includes('.')
    ? `.${
        fileName
          .split('.')
          .pop()
          ?.toLowerCase()
          .replace(/[^a-z0-9]/g, '') ?? ''
      }`
    : '';
  return `${entityType.toLowerCase()}/${entityId}/${randomUUID()}${extension}`;
}

// ---------------------------------------------------------------------------
// Signed URLs
// ---------------------------------------------------------------------------

export interface SignedUpload {
  uploadUrl: string;
  /** Supabase requires this back on the PUT. */
  token: string;
  objectPath: string;
  bucket: string;
  expiresInSeconds: number;
}

export async function createSignedUpload(objectPath: string): Promise<SignedUpload> {
  const config = requireStorage(env);
  const { data, error } = await getClient()
    .storage.from(config.bucket)
    .createSignedUploadUrl(objectPath);

  if (error || !data) {
    log.error({ err: error, objectPath }, 'Could not create a signed upload URL');
    throw new Error(`Storage rejected the upload request: ${error?.message ?? 'unknown error'}`);
  }

  return {
    uploadUrl: data.signedUrl,
    token: data.token,
    objectPath,
    bucket: config.bucket,
    expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
  };
}

export async function createSignedDownload(
  objectPath: string,
  downloadName: string,
): Promise<{ url: string; expiresInSeconds: number }> {
  const config = requireStorage(env);
  const { data, error } = await getClient()
    .storage.from(config.bucket)
    .createSignedUrl(objectPath, DOWNLOAD_URL_TTL_SECONDS, { download: downloadName });

  if (error || !data) {
    log.error({ err: error, objectPath }, 'Could not create a signed download URL');
    throw new Error(`Storage rejected the download request: ${error?.message ?? 'unknown error'}`);
  }

  return { url: data.signedUrl, expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS };
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export interface StoredObject {
  sizeBytes: number;
  mimeType: string | null;
}

/**
 * Reads back what was actually stored.
 *
 * The client declared a size and a type when it asked for the URL; this is the
 * only point at which either can be believed. An upload that never happened,
 * or one that is 200 MB when it claimed 2, is caught here rather than becoming
 * a READY attachment that fails when somebody opens it.
 */
export async function describeStoredObject(objectPath: string): Promise<StoredObject | null> {
  const config = requireStorage(env);
  const lastSlash = objectPath.lastIndexOf('/');
  const folder = lastSlash === -1 ? '' : objectPath.slice(0, lastSlash);
  const name = objectPath.slice(lastSlash + 1);

  const { data, error } = await getClient()
    .storage.from(config.bucket)
    .list(folder, { search: name, limit: 1 });

  if (error) {
    log.error({ err: error, objectPath }, 'Could not inspect the stored object');
    return null;
  }

  const found = data?.find((item) => item.name === name);
  if (!found) return null;

  const metadata = found.metadata as { size?: number; mimetype?: string } | null;
  return {
    sizeBytes: metadata?.size ?? 0,
    mimeType: metadata?.mimetype ?? null,
  };
}

export async function deleteStoredObject(objectPath: string): Promise<void> {
  const config = requireStorage(env);
  const { error } = await getClient().storage.from(config.bucket).remove([objectPath]);
  if (error) {
    // Not fatal: the attachment row is already gone, and an orphaned object
    // costs storage rather than correctness. Logged so it can be swept later.
    log.warn({ err: error, objectPath }, 'Could not delete the stored object');
  }
}

/** Re-exported so callers can answer "why is upload unavailable?" precisely. */
export { ServiceUnconfiguredError };
