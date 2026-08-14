/**
 * Status badge — FF-1102 / FF-1105.
 *
 * One mapping from every domain status to a colour, so "overdue" looks the same
 * on the dashboard, the maintenance board and a report. Defined once here
 * because a status that is red in one place and grey in another teaches users
 * the colour means nothing.
 *
 * Every badge carries a dot as well as a tint. Colour on its own excludes
 * roughly one man in twelve, and a fleet screen is nine tenths status — the dot
 * gives each state a second, non-colour signal at no cost in space.
 */

import type {
  DamageStatus,
  DocumentStatus,
  DriverStatus,
  MaintenanceStatus,
  VehicleStatus,
} from '@fleetflow/shared';
import { Badge, type BadgeTone } from '@/components/ui/primitives';
import { humanise } from '@/lib/format';

type KnownStatus =
  VehicleStatus | MaintenanceStatus | DocumentStatus | DamageStatus | DriverStatus | string;

/**
 * Only three statuses are red, and all three mean "someone must act": an
 * expired document, an overdue job, a critical damage. Reserving red for those
 * is what keeps it meaningful — a screen where everything is red says nothing.
 */
const TONES: Record<string, BadgeTone> = {
  // Vehicles
  ACTIVE: 'success',
  UNDER_MAINTENANCE: 'warning',
  ARCHIVED: 'neutral',

  // Maintenance
  PLANNED: 'info',
  IN_PROGRESS: 'warning',
  COMPLETED: 'success',
  OVERDUE: 'danger',

  // Documents (derived server-side)
  VALID: 'success',
  EXPIRING_SOON: 'warning',
  EXPIRED: 'danger',

  // Damages
  REPORTED: 'warning',
  UNDER_REVIEW: 'info',
  LINKED: 'info',
  RESOLVED: 'success',
  REJECTED: 'neutral',

  // Drivers and users
  INACTIVE: 'neutral',
};

export function StatusBadge({ status, label }: { status: KnownStatus; label?: string }) {
  return (
    <Badge dot tone={TONES[status] ?? 'neutral'}>
      {label ?? humanise(status)}
    </Badge>
  );
}

/** Yes/no state that is not a domain status — "active", "invited", and so on. */
export function BooleanBadge({
  value,
  trueLabel,
  falseLabel,
  invert = false,
}: {
  value: boolean;
  trueLabel: string;
  falseLabel: string;
  invert?: boolean;
}) {
  const good = invert ? !value : value;
  return (
    <Badge dot tone={good ? 'success' : 'neutral'}>
      {value ? trueLabel : falseLabel}
    </Badge>
  );
}
