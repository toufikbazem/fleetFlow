/**
 * What every endpoint accepts and returns — FF-1301.
 *
 * One entry per route, naming the Zod schemas that already define the contract.
 * Nothing here restates a shape: the schemas are imported, and the generator
 * turns them into JSON Schema. A hand-written OpenAPI document would be a
 * second description of the same thing, and the first time somebody adds a
 * field and forgets the document, the two would disagree — silently, and in the
 * direction that misleads whoever is integrating against it.
 *
 * So the only thing written by hand is what the schemas cannot know: the prose,
 * the status codes, and which module governs the route.
 */

import {
  assignMechanicRequestSchema,
  assignmentListQuerySchema,
  assignmentListResponseSchema,
  assignmentResponseSchema,
  attachmentListResponseSchema,
  changeDamageStatusRequestSchema,
  changeMaintenanceStatusRequestSchema,
  changeVehicleStatusRequestSchema,
  closeAssignmentRequestSchema,
  convertToMaintenanceRequestSchema,
  createAssignmentRequestSchema,
  createDamageRequestSchema,
  createDocumentRequestSchema,
  createDocumentTypeRequestSchema,
  createDriverRequestSchema,
  createMaintenanceOpRequestSchema,
  createMaintenancePlanRequestSchema,
  createUserRequestSchema,
  createVehicleRequestSchema,
  damageListQuerySchema,
  damageListResponseSchema,
  damageResponseSchema,
  dashboardSchema,
  documentListQuerySchema,
  documentListResponseSchema,
  documentResponseSchema,
  documentTypeListResponseSchema,
  downloadUrlSchema,
  driverListQuerySchema,
  driverListResponseSchema,
  driverResponseSchema,
  forgotPasswordRequestSchema,
  loginRequestSchema,
  loginResponseSchema,
  maintenanceOpListQuerySchema,
  maintenanceOpListResponseSchema,
  maintenanceOpResponseSchema,
  maintenancePlanListQuerySchema,
  maintenancePlanListResponseSchema,
  maintenancePlanResponseSchema,
  meResponseSchema,
  mileageHistoryResponseSchema,
  notificationListQuerySchema,
  notificationListResponseSchema,
  notificationRunResultSchema,
  paginationQuerySchema,
  recordMileageRequestSchema,
  refreshResponseSchema,
  reportCatalogueSchema,
  reportExportQuerySchema,
  reportQuerySchema,
  reportResultSchema,
  requestUploadRequestSchema,
  resetPasswordRequestSchema,
  triggerRunResultSchema,
  unreadCountResponseSchema,
  updateDamageRequestSchema,
  updateDocumentRequestSchema,
  updateDriverRequestSchema,
  updateMaintenanceOpRequestSchema,
  updateMaintenancePlanRequestSchema,
  updateUserRequestSchema,
  updateVehicleRequestSchema,
  uploadTicketSchema,
  userListQuerySchema,
  userListResponseSchema,
  userResponseSchema,
  vehicleListQuerySchema,
  vehicleListResponseSchema,
  vehicleOverviewSchema,
  vehicleResponseSchema,
  vehicleTypeListResponseSchema,
  type Action,
  type Module,
} from '@fleetflow/shared';
import type { ZodTypeAny } from 'zod';

export interface Operation {
  /** `GET /vehicles/:id` — matched against the live router, so it cannot drift. */
  route: string;
  tag: string;
  summary: string;
  description?: string;
  /** The matrix cell that governs it, or how it is otherwise protected. */
  auth: { module: Module; action: Action } | 'any-authenticated' | 'public';
  query?: ZodTypeAny;
  body?: ZodTypeAny;
  /** Success status → schema. `null` means an empty body. */
  responses: Record<number, ZodTypeAny | null>;
  /** Requirement ids this endpoint serves, so the spec traces to the PRD. */
  prd?: string[];
}

const ok = (schema: ZodTypeAny): Record<number, ZodTypeAny> => ({ 200: schema });
const created = (schema: ZodTypeAny): Record<number, ZodTypeAny> => ({ 201: schema });

export const OPERATIONS: Operation[] = [
  // -------------------------------------------------------------------------
  {
    route: 'GET /healthz',
    tag: 'Health',
    summary: 'Liveness and dependency status',
    description:
      'Reports whether Postgres and Redis are reachable, and whether the optional storage and email features are configured. Reveals no fleet data.',
    auth: 'public',
    responses: { 200: null, 503: null },
  },

  // -------------------------------------------------------------------------
  {
    route: 'POST /auth/login',
    tag: 'Authentication',
    summary: 'Sign in',
    description:
      'Returns a short-lived access token in the body and sets an httpOnly refresh cookie. A failure is deliberately generic: it does not reveal whether the account exists.',
    auth: 'public',
    body: loginRequestSchema,
    responses: { ...ok(loginResponseSchema), 401: null, 429: null },
    prd: ['AUTH-01', 'AUTH-05'],
  },
  {
    route: 'POST /auth/refresh',
    tag: 'Authentication',
    summary: 'Exchange the refresh cookie for a new access token',
    description:
      'Authenticated by the cookie, never by a bearer token. Rotates on use; a replayed token is treated as theft and drops every session for that user.',
    auth: 'public',
    responses: { ...ok(refreshResponseSchema), 401: null },
    prd: ['AUTH-04'],
  },
  {
    route: 'POST /auth/logout',
    tag: 'Authentication',
    summary: 'End the session',
    description:
      'Revokes the refresh token and denylists the access token, so logout is real rather than cosmetic. Works with an already-expired access token.',
    auth: 'public',
    responses: { 204: null },
    prd: ['AUTH-04'],
  },
  {
    route: 'POST /auth/forgot-password',
    tag: 'Authentication',
    summary: 'Request a password reset',
    description: 'Always answers identically whether or not the address is registered.',
    auth: 'public',
    body: forgotPasswordRequestSchema,
    responses: { 202: null },
    prd: ['AUTH-02'],
  },
  {
    route: 'POST /auth/reset-password',
    tag: 'Authentication',
    summary: 'Set a new password with a reset token',
    description: 'The token is single-use and time-limited.',
    auth: 'public',
    body: resetPasswordRequestSchema,
    responses: { 204: null, 422: null },
    prd: ['AUTH-02'],
  },
  {
    route: 'GET /auth/me',
    tag: 'Authentication',
    summary: 'The signed-in user',
    auth: 'any-authenticated',
    responses: ok(meResponseSchema),
  },

  // -------------------------------------------------------------------------
  {
    route: 'GET /users',
    tag: 'Users',
    summary: 'List users',
    auth: { module: 'users', action: 'read' },
    query: userListQuerySchema,
    responses: ok(userListResponseSchema),
    prd: ['USR-01'],
  },
  {
    route: 'GET /users/:id',
    tag: 'Users',
    summary: 'One user',
    auth: { module: 'users', action: 'read' },
    responses: { ...ok(userResponseSchema), 404: null },
  },
  {
    route: 'POST /users',
    tag: 'Users',
    summary: 'Create a user',
    description:
      'Without a password the account is created unusable and an invitation is emailed, so a password never travels through a chat message.',
    auth: { module: 'users', action: 'create' },
    body: createUserRequestSchema,
    responses: { ...created(userResponseSchema), 409: null },
    prd: ['USR-01', 'USR-02', 'USR-04'],
  },
  {
    route: 'PATCH /users/:id',
    tag: 'Users',
    summary: 'Update a user',
    description:
      'A role change takes effect on the user’s next request: their existing access tokens stop being honoured immediately.',
    auth: { module: 'users', action: 'update' },
    body: updateUserRequestSchema,
    responses: { ...ok(userResponseSchema), 409: null },
    prd: ['USR-02'],
  },
  {
    route: 'POST /users/:id/deactivate',
    tag: 'Users',
    summary: 'Deactivate a user',
    description:
      'The account stops working immediately; every record it authored stays and stays attributed.',
    auth: { module: 'users', action: 'update' },
    responses: { ...ok(userResponseSchema), 409: null },
    prd: ['USR-03'],
  },
  {
    route: 'POST /users/:id/activate',
    tag: 'Users',
    summary: 'Reactivate a user',
    auth: { module: 'users', action: 'update' },
    responses: ok(userResponseSchema),
    prd: ['USR-03'],
  },
  {
    route: 'POST /users/:id/resend-invitation',
    tag: 'Users',
    summary: 'Re-send an invitation',
    auth: { module: 'users', action: 'update' },
    responses: { 200: null },
    prd: ['USR-04'],
  },
  {
    route: 'DELETE /users/:id',
    tag: 'Users',
    summary: 'Delete a user (soft)',
    description:
      'The row is retained and hidden, so authored history stays answerable. The last active administrator cannot be removed.',
    auth: { module: 'users', action: 'delete' },
    responses: { 204: null, 409: null },
    prd: ['USR-01'],
  },

  // -------------------------------------------------------------------------
  {
    route: 'GET /drivers',
    tag: 'Drivers',
    summary: 'List drivers',
    description: 'A Driver sees only their own record.',
    auth: { module: 'drivers', action: 'read' },
    query: driverListQuerySchema,
    responses: ok(driverListResponseSchema),
    prd: ['DRV-01'],
  },
  {
    route: 'GET /drivers/:id',
    tag: 'Drivers',
    summary: 'One driver',
    auth: { module: 'drivers', action: 'read' },
    responses: { ...ok(driverResponseSchema), 404: null },
  },
  {
    route: 'POST /drivers',
    tag: 'Drivers',
    summary: 'Create a driver',
    description: 'A login account is optional — most drivers have none.',
    auth: { module: 'drivers', action: 'create' },
    body: createDriverRequestSchema,
    responses: created(driverResponseSchema),
    prd: ['DRV-01', 'DRV-04'],
  },
  {
    route: 'PATCH /drivers/:id',
    tag: 'Drivers',
    summary: 'Update a driver',
    auth: { module: 'drivers', action: 'update' },
    body: updateDriverRequestSchema,
    responses: ok(driverResponseSchema),
  },
  {
    route: 'DELETE /drivers/:id',
    tag: 'Drivers',
    summary: 'Delete a driver (soft)',
    description: 'Refused while the driver still holds a vehicle.',
    auth: { module: 'drivers', action: 'delete' },
    responses: { 204: null, 409: null },
  },

  // -------------------------------------------------------------------------
  {
    route: 'GET /vehicle-types',
    tag: 'Vehicles',
    summary: 'List vehicle types',
    auth: { module: 'vehicles', action: 'read' },
    responses: ok(vehicleTypeListResponseSchema),
  },
  {
    route: 'GET /vehicles',
    tag: 'Vehicles',
    summary: 'List vehicles',
    description:
      'Archived vehicles are hidden unless `includeArchived` is set. A Driver sees only the vehicle they hold.',
    auth: { module: 'vehicles', action: 'read' },
    query: vehicleListQuerySchema,
    responses: ok(vehicleListResponseSchema),
    prd: ['VEH-04', 'VEH-06'],
  },
  {
    route: 'GET /vehicles/:id',
    tag: 'Vehicles',
    summary: 'One vehicle',
    auth: { module: 'vehicles', action: 'read' },
    responses: { ...ok(vehicleResponseSchema), 404: null },
  },
  {
    route: 'GET /vehicles/:id/overview',
    tag: 'Vehicles',
    summary: 'Vehicle detail with all four aggregate sections',
    description:
      'Driver history, upcoming maintenance, maintenance history and document status in one request — VEH-02 requires them without a separate navigation step.',
    auth: { module: 'vehicles', action: 'read' },
    responses: { ...ok(vehicleOverviewSchema), 404: null },
    prd: ['VEH-02', 'VEH-03'],
  },
  {
    route: 'GET /vehicles/:id/mileage',
    tag: 'Vehicles',
    summary: 'Odometer history',
    auth: { module: 'vehicles', action: 'read' },
    query: paginationQuerySchema,
    responses: ok(mileageHistoryResponseSchema),
    prd: ['VEH-05'],
  },
  {
    route: 'POST /vehicles/:id/mileage',
    tag: 'Vehicles',
    summary: 'Record an odometer reading',
    description:
      'Moves the vehicle’s current mileage and can bring mileage-triggered maintenance due. A reading below the current one is refused.',
    auth: { module: 'vehicles', action: 'update' },
    body: recordMileageRequestSchema,
    responses: { 201: null, 409: null },
    prd: ['VEH-05', 'MNT-02'],
  },
  {
    route: 'POST /vehicles',
    tag: 'Vehicles',
    summary: 'Create a vehicle',
    auth: { module: 'vehicles', action: 'create' },
    body: createVehicleRequestSchema,
    responses: { ...created(vehicleResponseSchema), 409: null },
    prd: ['VEH-01'],
  },
  {
    route: 'PATCH /vehicles/:id',
    tag: 'Vehicles',
    summary: 'Update a vehicle',
    description: 'Cannot change status — that is a lifecycle transition with its own endpoint.',
    auth: { module: 'vehicles', action: 'update' },
    body: updateVehicleRequestSchema,
    responses: ok(vehicleResponseSchema),
  },
  {
    route: 'POST /vehicles/:id/status',
    tag: 'Vehicles',
    summary: 'Change the vehicle status',
    description:
      'Follows the VEH-06 transition table. Archiving removes the vehicle from operational lists while preserving its history and costs.',
    auth: { module: 'vehicles', action: 'update' },
    body: changeVehicleStatusRequestSchema,
    responses: { ...ok(vehicleResponseSchema), 409: null },
    prd: ['VEH-06'],
  },
  {
    route: 'DELETE /vehicles/:id',
    tag: 'Vehicles',
    summary: 'Delete a vehicle (soft)',
    auth: { module: 'vehicles', action: 'delete' },
    responses: { 204: null },
    prd: ['VEH-01'],
  },

  // -------------------------------------------------------------------------
  {
    route: 'GET /assignments',
    tag: 'Assignments',
    summary: 'Assignment history',
    description:
      'Includes closed assignments — reassignment closes a row rather than overwriting it.',
    auth: { module: 'drivers', action: 'read' },
    query: assignmentListQuerySchema,
    responses: ok(assignmentListResponseSchema),
    prd: ['DRV-03'],
  },
  {
    route: 'POST /assignments',
    tag: 'Assignments',
    summary: 'Assign a vehicle to a driver',
    description:
      'One open assignment per vehicle, enforced by a database index. By default the existing assignment is closed as part of the same transaction; set `closeExisting: false` to be refused instead.',
    auth: { module: 'drivers', action: 'update' },
    body: createAssignmentRequestSchema,
    responses: { ...created(assignmentResponseSchema), 409: null },
    prd: ['DRV-02', 'DRV-03'],
  },
  {
    route: 'PATCH /assignments/:id/close',
    tag: 'Assignments',
    summary: 'End an assignment',
    auth: { module: 'drivers', action: 'update' },
    body: closeAssignmentRequestSchema,
    responses: { ...ok(assignmentResponseSchema), 409: null },
    prd: ['DRV-03'],
  },

  // -------------------------------------------------------------------------
  {
    route: 'GET /maintenance-plans',
    tag: 'Maintenance plans',
    summary: 'List plans',
    auth: { module: 'maintenance', action: 'read' },
    query: maintenancePlanListQuerySchema,
    responses: ok(maintenancePlanListResponseSchema),
    prd: ['MNT-04'],
  },
  {
    route: 'GET /maintenance-plans/:id',
    tag: 'Maintenance plans',
    summary: 'One plan',
    auth: { module: 'maintenance', action: 'read' },
    responses: { ...ok(maintenancePlanResponseSchema), 404: null },
  },
  {
    route: 'POST /maintenance-plans',
    tag: 'Maintenance plans',
    summary: 'Create a plan',
    description:
      'Targets exactly one vehicle or one vehicle type, and its interval must match its trigger — both enforced by the database as well as here.',
    auth: { module: 'maintenance', action: 'create' },
    body: createMaintenancePlanRequestSchema,
    responses: created(maintenancePlanResponseSchema),
    prd: ['MNT-02', 'MNT-04'],
  },
  {
    route: 'PATCH /maintenance-plans/:id',
    tag: 'Maintenance plans',
    summary: 'Update a plan',
    auth: { module: 'maintenance', action: 'update' },
    body: updateMaintenancePlanRequestSchema,
    responses: ok(maintenancePlanResponseSchema),
  },
  {
    route: 'DELETE /maintenance-plans/:id',
    tag: 'Maintenance plans',
    summary: 'Delete a plan (soft)',
    auth: { module: 'maintenance', action: 'delete' },
    responses: { 204: null },
  },

  // -------------------------------------------------------------------------
  {
    route: 'GET /maintenance',
    tag: 'Maintenance',
    summary: 'List maintenance operations',
    description:
      '`due=upcoming|overdue` is the dashboard’s own definition and is what its counters drill through to: it also catches work whose date or mileage has passed but which the daily sweep has not relabelled, and it understands mileage thresholds. A Mechanic sees only their assigned jobs; a Driver only their vehicle’s.',
    auth: { module: 'maintenance', action: 'read' },
    query: maintenanceOpListQuerySchema,
    responses: ok(maintenanceOpListResponseSchema),
    prd: ['MNT-01', 'MNT-06', 'DSH-04', 'DSH-05'],
  },
  {
    route: 'GET /maintenance/:id',
    tag: 'Maintenance',
    summary: 'One maintenance operation',
    auth: { module: 'maintenance', action: 'read' },
    responses: { ...ok(maintenanceOpResponseSchema), 404: null },
  },
  {
    route: 'POST /maintenance',
    tag: 'Maintenance',
    summary: 'Record a maintenance operation',
    description:
      'Scheduled work must be due by a date or a mileage, or it would never appear in an upcoming list and never become overdue.',
    auth: { module: 'maintenance', action: 'create' },
    body: createMaintenanceOpRequestSchema,
    responses: created(maintenanceOpResponseSchema),
    prd: ['MNT-01', 'MNT-05'],
  },
  {
    route: 'PATCH /maintenance/:id',
    tag: 'Maintenance',
    summary: 'Update a maintenance operation',
    description: 'The total cost is always derived from parts plus labour; it is never sent.',
    auth: { module: 'maintenance', action: 'update' },
    body: updateMaintenanceOpRequestSchema,
    responses: { ...ok(maintenanceOpResponseSchema), 409: null },
    prd: ['MNT-05'],
  },
  {
    route: 'PATCH /maintenance/:id/status',
    tag: 'Maintenance',
    summary: 'Change the job status',
    description:
      'Planned → in progress → completed. Completed is terminal: correcting a mistaken completion is an edit of the record, not a status change.',
    auth: { module: 'maintenance', action: 'update' },
    body: changeMaintenanceStatusRequestSchema,
    responses: { ...ok(maintenanceOpResponseSchema), 409: null },
    prd: ['MNT-06'],
  },
  {
    route: 'POST /maintenance/:id/assign',
    tag: 'Maintenance',
    summary: 'Assign a mechanic',
    auth: { module: 'maintenance', action: 'update' },
    body: assignMechanicRequestSchema,
    responses: ok(maintenanceOpResponseSchema),
    prd: ['MNT-07'],
  },
  {
    route: 'DELETE /maintenance/:id',
    tag: 'Maintenance',
    summary: 'Delete a maintenance operation (soft)',
    auth: { module: 'maintenance', action: 'delete' },
    responses: { 204: null },
  },
  {
    route: 'POST /maintenance/run-triggers',
    tag: 'Maintenance',
    summary: 'Run the trigger engine now',
    description:
      'Turns plans into jobs. Safe to call repeatedly: a partial unique index makes it idempotent, so a second run creates nothing.',
    auth: { module: 'maintenance', action: 'create' },
    responses: ok(triggerRunResultSchema),
    prd: ['MNT-02'],
  },

  // -------------------------------------------------------------------------
  {
    route: 'GET /document-types',
    tag: 'Documents',
    summary: 'List document types',
    auth: { module: 'documents', action: 'read' },
    responses: ok(documentTypeListResponseSchema),
    prd: ['DOC-06'],
  },
  {
    route: 'POST /document-types',
    tag: 'Documents',
    summary: 'Add a document type',
    auth: { module: 'documents', action: 'create' },
    body: createDocumentTypeRequestSchema,
    responses: { 201: null },
    prd: ['DOC-06'],
  },
  {
    route: 'DELETE /document-types/:id',
    tag: 'Documents',
    summary: 'Remove a document type',
    auth: { module: 'documents', action: 'delete' },
    responses: { 204: null, 409: null },
    prd: ['DOC-06'],
  },
  {
    route: 'GET /documents',
    tag: 'Documents',
    summary: 'List documents',
    description:
      'Status is derived in SQL from the expiry date and the effective notice period, never stored — so filtering and display can never disagree. Archived vehicles’ documents are hidden unless `includeArchived` is set or a `vehicleId` is named.',
    auth: { module: 'documents', action: 'read' },
    query: documentListQuerySchema,
    responses: ok(documentListResponseSchema),
    prd: ['DOC-01', 'DOC-05'],
  },
  {
    route: 'GET /documents/:id',
    tag: 'Documents',
    summary: 'One document',
    auth: { module: 'documents', action: 'read' },
    responses: { ...ok(documentResponseSchema), 404: null },
  },
  {
    route: 'POST /documents',
    tag: 'Documents',
    summary: 'Add a document',
    auth: { module: 'documents', action: 'create' },
    body: createDocumentRequestSchema,
    responses: created(documentResponseSchema),
    prd: ['DOC-01', 'DOC-03'],
  },
  {
    route: 'PATCH /documents/:id',
    tag: 'Documents',
    summary: 'Update a document',
    auth: { module: 'documents', action: 'update' },
    body: updateDocumentRequestSchema,
    responses: ok(documentResponseSchema),
  },
  {
    route: 'DELETE /documents/:id',
    tag: 'Documents',
    summary: 'Delete a document (soft)',
    auth: { module: 'documents', action: 'delete' },
    responses: { 204: null },
  },

  // -------------------------------------------------------------------------
  {
    route: 'GET /attachments/status',
    tag: 'Attachments',
    summary: 'Whether object storage is configured',
    description:
      'Returns 200 with `configured: false` rather than failing, so the client can explain why uploading is unavailable.',
    auth: 'any-authenticated',
    responses: { 200: null },
  },
  {
    route: 'GET /attachments',
    tag: 'Attachments',
    summary: 'Attachments for one entity',
    auth: 'any-authenticated',
    responses: ok(attachmentListResponseSchema),
  },
  {
    route: 'POST /attachments/upload-url',
    tag: 'Attachments',
    summary: 'Request a signed upload URL',
    description:
      'Step one of two. The declared type and size are validated here and re-checked against the stored object on confirmation, so the client’s claim is never trusted. Returns 503 while storage is unconfigured.',
    auth: 'any-authenticated',
    body: requestUploadRequestSchema,
    responses: { ...created(uploadTicketSchema), 422: null, 503: null },
    prd: ['DOC-02', 'MNT-03', 'DMG-04'],
  },
  {
    route: 'POST /attachments/:id/confirm',
    tag: 'Attachments',
    summary: 'Confirm an upload',
    description:
      'Step two. The attachment becomes readable only after the stored object’s real size and content type have been verified.',
    auth: 'any-authenticated',
    responses: { 200: null, 409: null },
  },
  {
    route: 'GET /attachments/:id/download-url',
    tag: 'Attachments',
    summary: 'Signed download URL',
    description: 'Buckets are private; every download is a short-lived signed URL.',
    auth: 'any-authenticated',
    responses: { ...ok(downloadUrlSchema), 503: null },
  },
  {
    route: 'DELETE /attachments/:id',
    tag: 'Attachments',
    summary: 'Delete an attachment (soft)',
    auth: 'any-authenticated',
    responses: { 204: null },
  },

  // -------------------------------------------------------------------------
  {
    route: 'GET /damages',
    tag: 'Damages',
    summary: 'List damage reports',
    auth: { module: 'damages', action: 'read' },
    query: damageListQuerySchema,
    responses: ok(damageListResponseSchema),
    prd: ['DMG-01'],
  },
  {
    route: 'GET /damages/:id',
    tag: 'Damages',
    summary: 'One damage report',
    auth: { module: 'damages', action: 'read' },
    responses: { ...ok(damageResponseSchema), 404: null },
  },
  {
    route: 'POST /damages',
    tag: 'Damages',
    summary: 'Report damage',
    description: 'A Driver may report only on the vehicle they currently hold.',
    auth: { module: 'damages', action: 'create' },
    body: createDamageRequestSchema,
    responses: created(damageResponseSchema),
    prd: ['DMG-01', 'DMG-03'],
  },
  {
    route: 'PATCH /damages/:id',
    tag: 'Damages',
    summary: 'Update a damage report',
    auth: { module: 'damages', action: 'update' },
    body: updateDamageRequestSchema,
    responses: ok(damageResponseSchema),
  },
  {
    route: 'PATCH /damages/:id/status',
    tag: 'Damages',
    summary: 'Triage a damage report',
    description:
      '`LINKED` cannot be set by hand: it asserts that a maintenance job exists, and only conversion creates one. Resolved and rejected are terminal.',
    auth: { module: 'damages', action: 'update' },
    body: changeDamageStatusRequestSchema,
    responses: { ...ok(damageResponseSchema), 409: null },
    prd: ['DMG-01'],
  },
  {
    route: 'POST /damages/:id/archive',
    tag: 'Damages',
    summary: 'Archive a damage report',
    auth: { module: 'damages', action: 'update' },
    responses: ok(damageResponseSchema),
    prd: ['DMG-01'],
  },
  {
    route: 'POST /damages/:id/restore',
    tag: 'Damages',
    summary: 'Restore an archived damage report',
    auth: { module: 'damages', action: 'update' },
    responses: ok(damageResponseSchema),
  },
  {
    route: 'POST /damages/:id/convert-to-maintenance',
    tag: 'Damages',
    summary: 'Raise a maintenance job from a report',
    description:
      'The job is visible from the damage and the damage from the job. A report can be converted once.',
    auth: { module: 'maintenance', action: 'create' },
    body: convertToMaintenanceRequestSchema,
    responses: { ...created(maintenanceOpResponseSchema), 409: null },
    prd: ['DMG-02'],
  },
  {
    route: 'DELETE /damages/:id',
    tag: 'Damages',
    summary: 'Delete a damage report (soft)',
    auth: { module: 'damages', action: 'delete' },
    responses: { 204: null },
  },

  // -------------------------------------------------------------------------
  {
    route: 'GET /notifications',
    tag: 'Notifications',
    summary: 'Your notifications',
    description:
      'Addressed to a person, not to a module: every role has a notification centre, scoped to their own id.',
    auth: 'any-authenticated',
    query: notificationListQuerySchema,
    responses: ok(notificationListResponseSchema),
    prd: ['NTF-06'],
  },
  {
    route: 'GET /notifications/unread-count',
    tag: 'Notifications',
    summary: 'Unread count for the bell badge',
    auth: 'any-authenticated',
    responses: ok(unreadCountResponseSchema),
    prd: ['NTF-06'],
  },
  {
    route: 'POST /notifications/:id/read',
    tag: 'Notifications',
    summary: 'Mark one notification read',
    description: 'Another user’s notification answers 404 rather than confirming it exists.',
    auth: 'any-authenticated',
    responses: { 200: null, 404: null },
    prd: ['NTF-06'],
  },
  {
    route: 'POST /notifications/read-all',
    tag: 'Notifications',
    summary: 'Mark everything read',
    auth: 'any-authenticated',
    responses: { 200: null },
    prd: ['NTF-06'],
  },
  {
    route: 'POST /notifications/run',
    tag: 'Notifications',
    summary: 'Evaluate the notification rules now',
    description:
      'The scheduled job runs daily; this exists for acceptance testing. Safe to call repeatedly — one notification per rule, per entity, per day is enforced by a unique index, so a second run creates nothing.',
    auth: { module: 'reports', action: 'read' },
    responses: ok(notificationRunResultSchema),
    prd: ['NTF-05', 'NTF-07'],
  },
  {
    route: 'POST /notifications/flush-email',
    tag: 'Notifications',
    summary: 'Send whatever is queued',
    description:
      'Useful the moment SMTP is first configured. While it is not, queued mail is held rather than failed.',
    auth: { module: 'reports', action: 'read' },
    responses: { 200: null },
  },
  {
    route: 'GET /notifications/delivery-health',
    tag: 'Notifications',
    summary: 'Email delivery health',
    description:
      'Queued, sent and failed counts plus the oldest queued timestamp. A growing queue is what silent email failure looks like from the outside.',
    auth: { module: 'reports', action: 'read' },
    responses: { 200: null },
  },

  // -------------------------------------------------------------------------
  {
    route: 'GET /dashboard',
    tag: 'Dashboard',
    summary: 'All eight dashboard widgets',
    description:
      'Assembled per role: a section arrives as `null` when the caller’s role cannot see it, so one response shape serves all five roles. Every counter carries the query that reproduces the rows behind it, which is what makes a counter and the list it opens agree. Cached in Redis for five minutes and retired on any write.',
    auth: 'any-authenticated',
    responses: ok(dashboardSchema),
    prd: ['DSH-01', 'DSH-02', 'DSH-03', 'DSH-04', 'DSH-05', 'DSH-06', 'DSH-07', 'DSH-08'],
  },

  // -------------------------------------------------------------------------
  {
    route: 'GET /reports',
    tag: 'Reports',
    summary: 'The five available reports',
    auth: { module: 'reports', action: 'read' },
    responses: ok(reportCatalogueSchema),
    prd: ['RPT-01', 'RPT-02', 'RPT-03', 'RPT-04', 'RPT-05'],
  },
  {
    route: 'GET /reports/:name',
    tag: 'Reports',
    summary: 'Run a report',
    description:
      'Every report returns the same shape — typed columns and rows — so one client screen serves all five. Totals are computed over the whole filtered set, never over the visible page.',
    auth: { module: 'reports', action: 'read' },
    query: reportQuerySchema,
    responses: ok(reportResultSchema),
    prd: ['RPT-01', 'RPT-07'],
  },
  {
    route: 'GET /reports/:name/export',
    tag: 'Reports',
    summary: 'Export a report as CSV, xlsx or PDF',
    description:
      'Produced from the same filters the screen used and covering the whole result set, not the visible page — so an exported figure reconciles with the dashboard. Returns a file attachment, capped at 50 000 rows.',
    auth: { module: 'reports', action: 'read' },
    query: reportExportQuerySchema,
    responses: { 200: null, 422: null },
    prd: ['RPT-06'],
  },
];
