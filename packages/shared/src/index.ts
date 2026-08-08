/**
 * @fleetflow/shared — the single source of truth for the API contract.
 *
 * Everything crossing the wire is declared here once: Zod schemas, the types
 * inferred from them, the permission matrix and the shared enums. The API
 * validates with these; the web app infers its types and reuses the same
 * schemas for form validation. A breaking change therefore fails `tsc` on
 * both sides immediately, which is what keeps ten modules from drifting apart.
 */

export const SHARED_CONTRACT_VERSION = '0.1.0' as const;

export * from './enums.js';
export * from './permissions.js';
export * from './settings.js';
export * from './schemas/common.js';
export * from './schemas/auth.js';
export * from './schemas/users.js';
export * from './schemas/drivers.js';
export * from './schemas/vehicles.js';
export * from './schemas/assignments.js';
export * from './schemas/maintenance.js';
export * from './schemas/documents.js';
export * from './schemas/damages.js';
export * from './schemas/notifications.js';
export * from './schemas/dashboard.js';
export * from './schemas/reports.js';
export * from './domain.js';
