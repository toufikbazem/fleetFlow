/**
 * Soft-delete extension, against a real database — FF-105.
 *
 * These assertions cannot be made against a mock: the point is that Prisma's
 * generated SQL actually excludes the rows, including on nested reads, and only
 * Postgres can confirm that.
 *
 * Run with `npm run test:integration` (needs `npm run db:up`).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SOFT_DELETE_MODELS, disconnectDb, isSoftDeletable, prisma, withDeleted } from './db.js';

// Fixed ids in a range the seed never uses, so the two cannot collide.
const T = {
  vehicleType: 'ffffffff-0000-4000-8000-000000000001',
  liveVehicle: 'ffffffff-0000-4000-8000-000000000002',
  deletedVehicle: 'ffffffff-0000-4000-8000-000000000003',
  documentType: 'ffffffff-0000-4000-8000-000000000004',
  liveDocument: 'ffffffff-0000-4000-8000-000000000005',
  deletedDocument: 'ffffffff-0000-4000-8000-000000000006',
  liveOp: 'ffffffff-0000-4000-8000-000000000007',
  deletedOp: 'ffffffff-0000-4000-8000-000000000008',
} as const;

const raw = withDeleted();

async function cleanup(): Promise<void> {
  await raw.maintenanceOp.deleteMany({ where: { id: { in: [T.liveOp, T.deletedOp] } } });
  await raw.document.deleteMany({ where: { id: { in: [T.liveDocument, T.deletedDocument] } } });
  await raw.vehicle.deleteMany({ where: { id: { in: [T.liveVehicle, T.deletedVehicle] } } });
  await raw.documentType.deleteMany({ where: { id: T.documentType } });
  await raw.vehicleType.deleteMany({ where: { id: T.vehicleType } });
}

beforeAll(async () => {
  await cleanup();

  await raw.vehicleType.create({ data: { id: T.vehicleType, name: 'FF105 Test Type' } });
  await raw.documentType.create({
    data: { id: T.documentType, code: 'ff105_test', label: 'FF105 Test Doc' },
  });

  await raw.vehicle.create({
    data: {
      id: T.liveVehicle,
      plate: 'FF105-LIVE',
      make: 'Test',
      model: 'Live',
      vehicleTypeId: T.vehicleType,
    },
  });
  await raw.vehicle.create({
    data: {
      id: T.deletedVehicle,
      plate: 'FF105-DELETED',
      make: 'Test',
      model: 'Deleted',
      vehicleTypeId: T.vehicleType,
      deletedAt: new Date(),
    },
  });

  // Both documents hang off the LIVE vehicle, so a nested read has a live and a
  // deleted child to distinguish.
  await raw.document.create({
    data: {
      id: T.liveDocument,
      vehicleId: T.liveVehicle,
      documentTypeId: T.documentType,
      expiryDate: new Date('2027-01-01'),
    },
  });
  await raw.document.create({
    data: {
      id: T.deletedDocument,
      vehicleId: T.liveVehicle,
      documentTypeId: T.documentType,
      expiryDate: new Date('2027-01-01'),
      deletedAt: new Date(),
    },
  });

  await raw.maintenanceOp.create({
    data: {
      id: T.liveOp,
      vehicleId: T.liveVehicle,
      kind: 'UNEXPECTED',
      title: 'FF105 live op',
      costParts: 10,
      costLabour: 5,
      costTotal: 15,
    },
  });
  await raw.maintenanceOp.create({
    data: {
      id: T.deletedOp,
      vehicleId: T.liveVehicle,
      kind: 'UNEXPECTED',
      title: 'FF105 deleted op',
      costParts: 100,
      costLabour: 50,
      costTotal: 150,
      deletedAt: new Date(),
    },
  });
});

afterAll(async () => {
  await cleanup();
  await disconnectDb();
});

describe('model detection', () => {
  it('covers exactly the models carrying deleted_at', () => {
    expect([...SOFT_DELETE_MODELS].sort()).toEqual([
      'Attachment',
      'Damage',
      'Document',
      'Driver',
      'MaintenanceOp',
      'MaintenancePlan',
      'User',
      'Vehicle',
    ]);
  });

  it('leaves append-only and reference tables alone', () => {
    // These deliberately have no deleted_at — see prisma/README.md.
    for (const model of ['Assignment', 'MileageReading', 'AuditLog', 'VehicleType', 'Setting']) {
      expect(isSoftDeletable(model), model).toBe(false);
    }
  });
});

describe('a soft-deleted row is invisible to every read operation', () => {
  it('findMany', async () => {
    const ids = (
      await prisma.vehicle.findMany({
        where: { id: { in: [T.liveVehicle, T.deletedVehicle] } },
        select: { id: true },
      })
    ).map((v) => v.id);
    expect(ids).toEqual([T.liveVehicle]);
  });

  it('findUnique', async () => {
    expect(await prisma.vehicle.findUnique({ where: { id: T.deletedVehicle } })).toBeNull();
    expect(await prisma.vehicle.findUnique({ where: { id: T.liveVehicle } })).not.toBeNull();
  });

  it('findUnique by a natural key, not just the id', async () => {
    expect(await prisma.vehicle.findUnique({ where: { plate: 'FF105-DELETED' } })).toBeNull();
    expect(await prisma.vehicle.findUnique({ where: { plate: 'FF105-LIVE' } })).not.toBeNull();
  });

  it('findUniqueOrThrow', async () => {
    await expect(
      prisma.vehicle.findUniqueOrThrow({ where: { id: T.deletedVehicle } }),
    ).rejects.toThrow();
  });

  it('findFirst', async () => {
    expect(await prisma.vehicle.findFirst({ where: { plate: 'FF105-DELETED' } })).toBeNull();
  });

  it('findFirstOrThrow', async () => {
    await expect(
      prisma.vehicle.findFirstOrThrow({ where: { plate: 'FF105-DELETED' } }),
    ).rejects.toThrow();
  });

  it('count', async () => {
    expect(
      await prisma.vehicle.count({ where: { id: { in: [T.liveVehicle, T.deletedVehicle] } } }),
    ).toBe(1);
  });

  it('aggregate — deleted costs must not inflate a total', async () => {
    const result = await prisma.maintenanceOp.aggregate({
      where: { vehicleId: T.liveVehicle },
      _sum: { costTotal: true },
    });
    // 15 from the live op; the deleted op's 150 must not be counted.
    expect(Number(result._sum.costTotal)).toBe(15);
  });

  it('groupBy', async () => {
    const groups = await prisma.maintenanceOp.groupBy({
      by: ['vehicleId'],
      where: { vehicleId: T.liveVehicle },
      _count: { _all: true },
    });
    expect(groups[0]?._count._all).toBe(1);
  });
});

describe('nested reads are filtered too', () => {
  it('include of a list relation excludes deleted children', async () => {
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: T.liveVehicle },
      include: { documents: true },
    });
    expect(vehicle?.documents.map((d) => d.id)).toEqual([T.liveDocument]);
  });

  it('select of a list relation excludes deleted children', async () => {
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: T.liveVehicle },
      select: { id: true, maintenanceOps: { select: { id: true } } },
    });
    expect(vehicle?.maintenanceOps.map((o) => o.id)).toEqual([T.liveOp]);
  });

  it('a caller-supplied nested where is preserved, not replaced', async () => {
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: T.liveVehicle },
      include: { documents: { where: { referenceNo: null } } },
    });
    // Still excludes the deleted document, and still honours the caller's filter.
    expect(vehicle?.documents.map((d) => d.id)).toEqual([T.liveDocument]);
  });

  it('deeply nested relations are filtered', async () => {
    const type = await prisma.vehicleType.findUnique({
      where: { id: T.vehicleType },
      include: { vehicles: { include: { documents: true } } },
    });
    expect(type?.vehicles.map((v) => v.id)).toEqual([T.liveVehicle]);
    expect(type?.vehicles[0]?.documents.map((d) => d.id)).toEqual([T.liveDocument]);
  });

  it('filters children even when the ROOT model has no deleted_at', async () => {
    // Regression: the extension used to return early for a non-soft-deletable
    // root, leaving its soft-deletable children unfiltered. VehicleType,
    // Assignment, MileageReading and AuditLog are all such roots.
    const type = await prisma.vehicleType.findUnique({
      where: { id: T.vehicleType },
      include: { vehicles: true },
    });
    expect(type?.vehicles.map((v) => v.id)).toEqual([T.liveVehicle]);
  });
});

describe('the escape hatches', () => {
  it('withDeleted() sees everything', async () => {
    const ids = (
      await withDeleted().vehicle.findMany({
        where: { id: { in: [T.liveVehicle, T.deletedVehicle] } },
        select: { id: true },
        orderBy: { plate: 'asc' },
      })
    ).map((v) => v.id);
    expect(ids).toEqual([T.deletedVehicle, T.liveVehicle]);
  });

  it('an explicit deletedAt filter wins over the automatic one', async () => {
    const onlyDeleted = await prisma.vehicle.findMany({
      where: { id: { in: [T.liveVehicle, T.deletedVehicle] }, deletedAt: { not: null } },
      select: { id: true },
    });
    expect(onlyDeleted.map((v) => v.id)).toEqual([T.deletedVehicle]);
  });

  it('an explicit deletedAt inside OR is respected', async () => {
    const both = await prisma.vehicle.findMany({
      where: {
        id: { in: [T.liveVehicle, T.deletedVehicle] },
        OR: [{ deletedAt: null }, { deletedAt: { not: null } }],
      },
      select: { id: true },
    });
    expect(both).toHaveLength(2);
  });
});

describe('writes are not intercepted', () => {
  it('soft delete is an update the service performs explicitly', async () => {
    await prisma.vehicle.update({
      where: { id: T.liveVehicle },
      data: { deletedAt: new Date() },
    });

    expect(await prisma.vehicle.findUnique({ where: { id: T.liveVehicle } })).toBeNull();
    expect(await withDeleted().vehicle.findUnique({ where: { id: T.liveVehicle } })).not.toBeNull();

    // Restore for the remaining assertions and cleanup.
    await raw.vehicle.update({ where: { id: T.liveVehicle }, data: { deletedAt: null } });
    expect(await prisma.vehicle.findUnique({ where: { id: T.liveVehicle } })).not.toBeNull();
  });
});

describe('non-soft-deletable models are untouched', () => {
  it('a model without deleted_at is queried normally', async () => {
    const type = await prisma.vehicleType.findUnique({ where: { id: T.vehicleType } });
    expect(type?.name).toBe('FF105 Test Type');
  });
});
