-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'FLEET_MANAGER', 'MECHANIC', 'ACCOUNTANT', 'DRIVER');

-- CreateEnum
CREATE TYPE "DriverStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('ACTIVE', 'UNDER_MAINTENANCE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MileageSource" AS ENUM ('MANUAL', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "MaintenanceStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE');

-- CreateEnum
CREATE TYPE "MaintenanceKind" AS ENUM ('SCHEDULED', 'UNEXPECTED');

-- CreateEnum
CREATE TYPE "TriggerType" AS ENUM ('DATE', 'MILEAGE', 'BOTH');

-- CreateEnum
CREATE TYPE "DamageStatus" AS ENUM ('REPORTED', 'UNDER_REVIEW', 'LINKED', 'RESOLVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DamageSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AttachmentEntity" AS ENUM ('DOCUMENT', 'MAINTENANCE_OP', 'DAMAGE');

-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('SCAN', 'INVOICE', 'PHOTO');

-- CreateEnum
CREATE TYPE "UploadState" AS ENUM ('PENDING', 'READY');

-- CreateEnum
CREATE TYPE "NotificationRule" AS ENUM ('MAINTENANCE_UPCOMING', 'DOCUMENT_EXPIRING', 'INSPECTION_DUE', 'MAINTENANCE_OVERDUE');

-- CreateEnum
CREATE TYPE "DeliveryChannel" AS ENUM ('EMAIL');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "deactivated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_resets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_resets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drivers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "licence_no" TEXT NOT NULL,
    "licence_category" TEXT,
    "licence_expiry" DATE,
    "phone" TEXT,
    "hired_at" DATE,
    "status" "DriverStatus" NOT NULL DEFAULT 'ACTIVE',
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plate" TEXT NOT NULL,
    "vin" TEXT,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER,
    "vehicle_type_id" UUID,
    "status" "VehicleStatus" NOT NULL DEFAULT 'ACTIVE',
    "current_mileage" INTEGER NOT NULL DEFAULT 0,
    "purchase_date" DATE,
    "purchase_price" DECIMAL(12,2),
    "insurance_value" DECIMAL(12,2),
    "notes" TEXT,
    "archived_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mileage_readings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vehicle_id" UUID NOT NULL,
    "mileage" INTEGER NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recorded_by" UUID,
    "source" "MileageSource" NOT NULL DEFAULT 'MANUAL',
    "note" TEXT,

    CONSTRAINT "mileage_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vehicle_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "ended_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "vehicle_id" UUID,
    "vehicle_type_id" UUID,
    "trigger_type" "TriggerType" NOT NULL,
    "interval_days" INTEGER,
    "interval_km" INTEGER,
    "notice_days" INTEGER NOT NULL DEFAULT 14,
    "notice_km" INTEGER NOT NULL DEFAULT 500,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_ops" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vehicle_id" UUID NOT NULL,
    "plan_id" UUID,
    "damage_id" UUID,
    "kind" "MaintenanceKind" NOT NULL DEFAULT 'SCHEDULED',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'PLANNED',
    "due_date" DATE,
    "due_mileage" INTEGER,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "completed_mileage" INTEGER,
    "mechanic_id" UUID,
    "cost_parts" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cost_labour" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cost_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "vendor" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_ops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "default_notice_days" INTEGER NOT NULL DEFAULT 30,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vehicle_id" UUID NOT NULL,
    "document_type_id" UUID NOT NULL,
    "reference_no" TEXT,
    "issue_date" DATE,
    "expiry_date" DATE NOT NULL,
    "notice_days" INTEGER,
    "notes" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "damages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vehicle_id" UUID NOT NULL,
    "reported_by" UUID NOT NULL,
    "driver_id" UUID,
    "description" TEXT NOT NULL,
    "severity" "DamageSeverity" NOT NULL DEFAULT 'MEDIUM',
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "status" "DamageStatus" NOT NULL DEFAULT 'REPORTED',
    "archived_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "damages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity_type" "AttachmentEntity" NOT NULL,
    "entity_id" UUID NOT NULL,
    "bucket" TEXT NOT NULL,
    "object_path" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "kind" "AttachmentKind" NOT NULL DEFAULT 'SCAN',
    "upload_state" "UploadState" NOT NULL DEFAULT 'PENDING',
    "uploaded_by" UUID,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "rule" "NotificationRule" NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "fire_date" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link_url" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "notification_id" UUID NOT NULL,
    "channel" "DeliveryChannel" NOT NULL DEFAULT 'EMAIL',
    "status" "DeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "smtp_message_id" TEXT,
    "smtp_response" TEXT,
    "rejected" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID,
    "changes" JSONB,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_deleted_at_idx" ON "users"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "password_resets_token_hash_key" ON "password_resets"("token_hash");

-- CreateIndex
CREATE INDEX "password_resets_user_id_idx" ON "password_resets"("user_id");

-- CreateIndex
CREATE INDEX "password_resets_expires_at_idx" ON "password_resets"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_user_id_key" ON "drivers"("user_id");

-- CreateIndex
CREATE INDEX "drivers_status_idx" ON "drivers"("status");

-- CreateIndex
CREATE INDEX "drivers_deleted_at_idx" ON "drivers"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_types_name_key" ON "vehicle_types"("name");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_plate_key" ON "vehicles"("plate");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_vin_key" ON "vehicles"("vin");

-- CreateIndex
CREATE INDEX "vehicles_status_idx" ON "vehicles"("status");

-- CreateIndex
CREATE INDEX "vehicles_vehicle_type_id_idx" ON "vehicles"("vehicle_type_id");

-- CreateIndex
CREATE INDEX "vehicles_deleted_at_idx" ON "vehicles"("deleted_at");

-- CreateIndex
CREATE INDEX "mileage_readings_vehicle_id_recorded_at_idx" ON "mileage_readings"("vehicle_id", "recorded_at");

-- CreateIndex
CREATE INDEX "assignments_vehicle_id_start_date_idx" ON "assignments"("vehicle_id", "start_date");

-- CreateIndex
CREATE INDEX "assignments_driver_id_start_date_idx" ON "assignments"("driver_id", "start_date");

-- CreateIndex
CREATE INDEX "maintenance_plans_vehicle_id_idx" ON "maintenance_plans"("vehicle_id");

-- CreateIndex
CREATE INDEX "maintenance_plans_vehicle_type_id_idx" ON "maintenance_plans"("vehicle_type_id");

-- CreateIndex
CREATE INDEX "maintenance_plans_is_active_idx" ON "maintenance_plans"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_ops_damage_id_key" ON "maintenance_ops"("damage_id");

-- CreateIndex
CREATE INDEX "maintenance_ops_vehicle_id_status_idx" ON "maintenance_ops"("vehicle_id", "status");

-- CreateIndex
CREATE INDEX "maintenance_ops_status_due_date_idx" ON "maintenance_ops"("status", "due_date");

-- CreateIndex
CREATE INDEX "maintenance_ops_mechanic_id_status_idx" ON "maintenance_ops"("mechanic_id", "status");

-- CreateIndex
CREATE INDEX "maintenance_ops_plan_id_idx" ON "maintenance_ops"("plan_id");

-- CreateIndex
CREATE INDEX "maintenance_ops_deleted_at_idx" ON "maintenance_ops"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "document_types_code_key" ON "document_types"("code");

-- CreateIndex
CREATE INDEX "documents_vehicle_id_idx" ON "documents"("vehicle_id");

-- CreateIndex
CREATE INDEX "documents_expiry_date_idx" ON "documents"("expiry_date");

-- CreateIndex
CREATE INDEX "documents_document_type_id_idx" ON "documents"("document_type_id");

-- CreateIndex
CREATE INDEX "documents_deleted_at_idx" ON "documents"("deleted_at");

-- CreateIndex
CREATE INDEX "damages_vehicle_id_status_idx" ON "damages"("vehicle_id", "status");

-- CreateIndex
CREATE INDEX "damages_status_idx" ON "damages"("status");

-- CreateIndex
CREATE INDEX "damages_deleted_at_idx" ON "damages"("deleted_at");

-- CreateIndex
CREATE INDEX "attachments_entity_type_entity_id_idx" ON "attachments"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "attachments_upload_state_idx" ON "attachments"("upload_state");

-- CreateIndex
CREATE INDEX "attachments_deleted_at_idx" ON "attachments"("deleted_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "notifications_fire_date_idx" ON "notifications"("fire_date");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_user_id_rule_entity_type_entity_id_fire_date_key" ON "notifications"("user_id", "rule", "entity_type", "entity_id", "fire_date");

-- CreateIndex
CREATE INDEX "notification_deliveries_notification_id_idx" ON "notification_deliveries"("notification_id");

-- CreateIndex
CREATE INDEX "notification_deliveries_status_idx" ON "notification_deliveries"("status");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_idx" ON "audit_log"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_actor_user_id_idx" ON "audit_log"("actor_user_id");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- AddForeignKey
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_vehicle_type_id_fkey" FOREIGN KEY ("vehicle_type_id") REFERENCES "vehicle_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mileage_readings" ADD CONSTRAINT "mileage_readings_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mileage_readings" ADD CONSTRAINT "mileage_readings_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_ended_by_fkey" FOREIGN KEY ("ended_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_vehicle_type_id_fkey" FOREIGN KEY ("vehicle_type_id") REFERENCES "vehicle_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_ops" ADD CONSTRAINT "maintenance_ops_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_ops" ADD CONSTRAINT "maintenance_ops_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "maintenance_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_ops" ADD CONSTRAINT "maintenance_ops_damage_id_fkey" FOREIGN KEY ("damage_id") REFERENCES "damages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_ops" ADD CONSTRAINT "maintenance_ops_mechanic_id_fkey" FOREIGN KEY ("mechanic_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_document_type_id_fkey" FOREIGN KEY ("document_type_id") REFERENCES "document_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damages" ADD CONSTRAINT "damages_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damages" ADD CONSTRAINT "damages_reported_by_fkey" FOREIGN KEY ("reported_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damages" ADD CONSTRAINT "damages_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ===========================================================================
-- Constraints Prisma cannot express, appended by hand (FF-103).
--
-- Prisma's schema language has no syntax for partial indexes or CHECK
-- constraints, so these live here. They are part of the migration history and
-- therefore part of the shadow database, so `prisma migrate dev` will not
-- silently lose them — but see prisma/README.md before editing this file.
-- ===========================================================================

-- Q5 — one driver per vehicle.
-- At most one assignment row per vehicle may be open (end_date IS NULL).
-- Closed assignments are unconstrained, so the full history (VEH-03, DRV-03)
-- is preserved. This is the decision the client made on 7 Aug 2026, enforced
-- by the database rather than by a service-layer check that a future endpoint
-- could forget.
CREATE UNIQUE INDEX "assignments_one_open_per_vehicle"
  ON "assignments" ("vehicle_id")
  WHERE "end_date" IS NULL;

-- An assignment cannot end before it starts.
ALTER TABLE "assignments"
  ADD CONSTRAINT "assignments_dates_ordered"
  CHECK ("end_date" IS NULL OR "end_date" >= "start_date");

-- MNT-04 — a plan targets exactly one of: a single vehicle, or a vehicle type.
-- Both set would make "which plan applies" ambiguous; neither set would make
-- the plan unreachable.
ALTER TABLE "maintenance_plans"
  ADD CONSTRAINT "maintenance_plans_exactly_one_target"
  CHECK (num_nonnulls("vehicle_id", "vehicle_type_id") = 1);

-- A plan must carry an interval for whatever it claims to trigger on,
-- otherwise the trigger engine (FF-503) has nothing to compute from.
ALTER TABLE "maintenance_plans"
  ADD CONSTRAINT "maintenance_plans_interval_matches_trigger"
  CHECK (
    ("trigger_type" = 'DATE'    AND "interval_days" IS NOT NULL)
    OR ("trigger_type" = 'MILEAGE' AND "interval_km"   IS NOT NULL)
    OR ("trigger_type" = 'BOTH'    AND "interval_days" IS NOT NULL AND "interval_km" IS NOT NULL)
  );

ALTER TABLE "maintenance_plans"
  ADD CONSTRAINT "maintenance_plans_intervals_positive"
  CHECK (
    ("interval_days" IS NULL OR "interval_days" > 0)
    AND ("interval_km" IS NULL OR "interval_km" > 0)
  );

-- MNT-05 / RPT-06 — cost_total is pinned to its components, so an exported
-- figure can never disagree with the dashboard summary for the same period.
ALTER TABLE "maintenance_ops"
  ADD CONSTRAINT "maintenance_ops_cost_total_consistent"
  CHECK ("cost_total" = "cost_parts" + "cost_labour");

ALTER TABLE "maintenance_ops"
  ADD CONSTRAINT "maintenance_ops_costs_non_negative"
  CHECK ("cost_parts" >= 0 AND "cost_labour" >= 0);

-- A scheduled operation needs something to be due by; an unexpected one does not.
ALTER TABLE "maintenance_ops"
  ADD CONSTRAINT "maintenance_ops_scheduled_has_trigger"
  CHECK (
    "kind" <> 'SCHEDULED'
    OR "due_date" IS NOT NULL
    OR "due_mileage" IS NOT NULL
  );

-- Mileage is cumulative; a negative odometer reading is always an error.
ALTER TABLE "mileage_readings"
  ADD CONSTRAINT "mileage_readings_non_negative"
  CHECK ("mileage" >= 0);

ALTER TABLE "vehicles"
  ADD CONSTRAINT "vehicles_mileage_non_negative"
  CHECK ("current_mileage" >= 0);

-- DOC-03 — a notice period of zero would mean "warn on the day it expires",
-- which defeats the purpose of the reminder.
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_notice_days_positive"
  CHECK ("notice_days" IS NULL OR "notice_days" > 0);

ALTER TABLE "document_types"
  ADD CONSTRAINT "document_types_default_notice_days_positive"
  CHECK ("default_notice_days" > 0);

-- Uploads are bounded by policy (Q12: 20 MB); a zero-byte object is a failed
-- upload, not a document.
ALTER TABLE "attachments"
  ADD CONSTRAINT "attachments_size_positive"
  CHECK ("size_bytes" > 0);
