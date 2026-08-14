/**
 * API client — FF-1103.
 *
 * **Where the access token lives, and why it matters.**
 *
 * In memory. Not localStorage, not sessionStorage, not a readable cookie. Any
 * of those can be read by injected JavaScript, and a stolen access token is a
 * valid session for its full lifetime — the server cannot tell it from the real
 * one. Keeping it in a module variable means an XSS payload has to run *inside*
 * this page to use it, and cannot exfiltrate it for later.
 *
 * The cost is that a page refresh loses the token. That is what the refresh
 * cookie is for: it is httpOnly, so script cannot read it at all, and
 * `restoreSession()` exchanges it for a fresh access token on boot. The session
 * survives; the credential never sits somewhere a script can reach.
 */

import type { ErrorResponse, LoginResponse } from '@fleetflow/shared';

const API_PREFIX = '/api/v1';

let accessToken: string | null = null;

/** Notified whenever the session appears or disappears, so React can re-render. */
type SessionListener = (token: string | null) => void;
const listeners = new Set<SessionListener>();

export function onSessionChange(listener: SessionListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
  for (const listener of listeners) listener(token);
}

export function getAccessToken(): string | null {
  return accessToken;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** A failure the API described. Carries the machine-readable code and fields. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Array<{ path: string; message: string }>;
  readonly requestId: string | undefined;

  constructor(status: number, body: ErrorResponse | undefined, fallback: string) {
    super(body?.error.message ?? fallback);
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.error.code ?? 'INTERNAL';
    this.details = body?.error.details ?? [];
    this.requestId = body?.error.requestId;
  }

  /** Field errors keyed by the form field they belong to, for react-hook-form. */
  fieldErrors(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const detail of this.details) {
      // Paths arrive source-prefixed (`body.email`); forms know the bare name.
      const field = detail.path.replace(/^(body|query|params)\./, '');
      result[field] ??= detail.message;
    }
    return result;
  }
}

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

/**
 * One in-flight refresh, shared.
 *
 * A dashboard fires several queries at once. If the access token has expired,
 * every one of them gets a 401 simultaneously — and without this, every one
 * would call /auth/refresh. Since FF-202 rotates on use and treats a replayed
 * token as theft, the second request would consume an already-consumed token
 * and the server would correctly drop every session for that user. The bug
 * would look like "random logouts", and its cause would be here.
 */
let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(`${API_PREFIX}/auth/refresh`, {
        method: 'POST',
        // The refresh cookie is httpOnly and path-scoped; it only travels when
        // credentials are explicitly included.
        credentials: 'include',
      });

      if (!response.ok) {
        setAccessToken(null);
        return null;
      }

      const body = (await response.json()) as LoginResponse;
      setAccessToken(body.accessToken);
      return body.accessToken;
    } catch {
      setAccessToken(null);
      return null;
    } finally {
      // Cleared in a microtask so concurrent callers all observe the same
      // promise before the next refresh can start.
      queueMicrotask(() => {
        refreshInFlight = null;
      });
    }
  })();

  return refreshInFlight;
}

/** Called once at boot: turns a surviving refresh cookie back into a session. */
export async function restoreSession(): Promise<boolean> {
  return (await refreshAccessToken()) !== null;
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** Internal: prevents a refreshed request from retrying forever. */
  retrying?: boolean;
}

function buildUrl(path: string, query: RequestOptions['query']): string {
  const url = `${API_PREFIX}${path}`;
  if (!query) return url;

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${url}?${qs}` : url;
}

async function parseError(response: Response): Promise<ErrorResponse | undefined> {
  try {
    return (await response.json()) as ErrorResponse;
  } catch {
    return undefined;
  }
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, retrying = false } = options;

  const headers: Record<string, string> = {};
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(buildUrl(path, query), {
    method,
    headers,
    credentials: 'include',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  // One retry, and only one: if the refreshed token is also rejected, the
  // session is genuinely over and looping would just hammer the endpoint.
  if (response.status === 401 && !retrying) {
    const renewed = await refreshAccessToken();
    if (renewed) {
      return apiRequest<T>(path, { ...options, retrying: true });
    }
  }

  if (!response.ok) {
    throw new ApiError(response.status, await parseError(response), response.statusText);
  }

  // 204 and other empty bodies.
  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return undefined as T;
  }

  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// File downloads — RPT-06
// ---------------------------------------------------------------------------

/**
 * Fetches a file and hands it to the browser as a download.
 *
 * **Why not just a link.** The access token lives in memory, deliberately (see
 * the note at the top of this file), so a plain `<a href="/api/v1/…/export">`
 * would navigate without an Authorization header and be answered with a 401 —
 * as an HTML error page the user would then have downloaded. Fetching lets the
 * header travel, lets a 401 go through the same refresh-and-retry path as every
 * other request, and lets a real error be shown as a toast rather than saved to
 * the Downloads folder.
 *
 * The object URL is revoked immediately: the download has already been handed
 * to the browser by then, and leaving it alive pins the whole blob in memory
 * for the lifetime of the document.
 */
export async function apiDownload(path: string, query?: RequestOptions['query']): Promise<void> {
  const headers: Record<string, string> = {};
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  let response = await fetch(buildUrl(path, query), { headers, credentials: 'include' });

  if (response.status === 401) {
    const renewed = await refreshAccessToken();
    if (renewed) {
      response = await fetch(buildUrl(path, query), {
        headers: { Authorization: `Bearer ${renewed}` },
        credentials: 'include',
      });
    }
  }

  if (!response.ok) {
    throw new ApiError(response.status, await parseError(response), response.statusText);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  // The server already named the file in Content-Disposition, but fetch cannot
  // apply it, so the name is read back out of the header.
  anchor.download = filenameFrom(response.headers.get('content-disposition'));
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function filenameFrom(disposition: string | null): string {
  const match = disposition?.match(/filename="([^"]+)"/);
  return match?.[1] ?? 'export';
}

// ---------------------------------------------------------------------------
// Session commands
// ---------------------------------------------------------------------------

export async function login(email: string, password: string): Promise<LoginResponse> {
  const result = await apiRequest<LoginResponse>('/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  setAccessToken(result.accessToken);
  return result;
}

export async function logout(): Promise<void> {
  try {
    await apiRequest<void>('/auth/logout', { method: 'POST' });
  } finally {
    // Cleared even if the call failed: the user asked to sign out, and leaving
    // a token in memory because the network hiccuped is the wrong answer.
    setAccessToken(null);
  }
}
