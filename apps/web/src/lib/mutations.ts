/**
 * Mutation helpers — FF-1103.
 *
 * One place that turns an ApiError into something the user and the form can
 * both act on. Without it every screen reinvents the same three branches, and
 * the one that forgets `fieldErrors()` shows "The submitted data is invalid"
 * with no indication of which field.
 */

import type { UseFormSetError } from 'react-hook-form';
import { toast } from 'sonner';
import { ApiError } from './api-client';

/**
 * Routes a failure to wherever it is most useful.
 *
 * Field-level validation goes onto the offending inputs. Everything else — a
 * conflict, a permission refusal, a server fault — is a toast, because it is
 * about the operation rather than about one control.
 */
export function reportMutationError<Fields extends Record<string, unknown>>(
  error: unknown,
  setError?: UseFormSetError<Fields>,
): void {
  if (!(error instanceof ApiError)) {
    toast.error('Could not reach FleetFlow. Check your connection and try again.');
    return;
  }

  if (error.code === 'VALIDATION_FAILED' && setError) {
    const fields = error.fieldErrors();
    const names = Object.keys(fields);

    if (names.length > 0) {
      for (const [field, message] of Object.entries(fields)) {
        setError(field as Parameters<UseFormSetError<Fields>>[0], { type: 'server', message });
      }
      return;
    }
  }

  // 409 conflicts carry the most useful sentences in the product — "this is the
  // only active administrator", "the driver still holds a vehicle" — so they are
  // shown verbatim rather than replaced with a generic apology.
  toast.error(error.message);
}

export function reportSuccess(message: string): void {
  toast.success(message);
}
