/**
 * Seed — FF-103.
 *
 * Three layers, in dependency order:
 *
 *   1. Settings          the client's agreed defaults (Q4, Q8), read from
 *                        @fleetflow/shared so the app and the database cannot
 *                        disagree about what a default is.
 *   2. Reference data    vehicle types and document types. Required for the
 *                        product to function at all.
 *   3. Demo fleet        users, drivers, vehicles and a spread of maintenance,
 *                        documents and damages chosen to exercise every status
 *                        a screen has to render — including an expired
 *                        document and an overdue job, which are the states
 *                        most often forgotten until UAT.
 *
 * Idempotent: every row is upserted against a fixed UUID, so re-running is
 * safe and never violates the one-open-assignment-per-vehicle index.
 */

import { PrismaClient } from '@prisma/client';
import { DEFAULT_SETTINGS } from '@fleetflow/shared';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/** Development credential for every seeded account. Never used outside seeding. */
const DEMO_PASSWORD = 'FleetFlow-Dev-2026!';
const BCRYPT_COST = 12;

// Fixed ids keep the seed idempotent and make records easy to reference by eye.
const ID = {
  user: {
    admin: '00000000-0000-4000-8000-000000000001',
    manager: '00000000-0000-4000-8000-000000000002',
    mechanic: '00000000-0000-4000-8000-000000000003',
    accountant: '00000000-0000-4000-8000-000000000004',
    driverAmina: '00000000-0000-4000-8000-000000000005',
    driverYoussef: '00000000-0000-4000-8000-000000000006',
  },
  driver: {
    amina: '00000000-0000-4000-8000-000000000101',
    youssef: '00000000-0000-4000-8000-000000000102',
    unlinked: '00000000-0000-4000-8000-000000000103',
  },
  vehicleType: {
    van: '00000000-0000-4000-8000-000000000201',
    truck: '00000000-0000-4000-8000-000000000202',
    car: '00000000-0000-4000-8000-000000000203',
  },
  vehicle: {
    van1: '00000000-0000-4000-8000-000000000301',
    van2: '00000000-0000-4000-8000-000000000302',
    truck1: '00000000-0000-4000-8000-000000000303',
    car1: '00000000-0000-4000-8000-000000000304',
    archived: '00000000-0000-4000-8000-000000000305',
  },
  assignment: {
    van1Open: '00000000-0000-4000-8000-000000000401',
    truck1Open: '00000000-0000-4000-8000-000000000402',
    van1Closed: '00000000-0000-4000-8000-000000000403',
  },
  plan: {
    vanService: '00000000-0000-4000-8000-000000000501',
    truckService: '00000000-0000-4000-8000-000000000502',
    car1Specific: '00000000-0000-4000-8000-000000000503',
  },
  op: {
    planned: '00000000-0000-4000-8000-000000000601',
    inProgress: '00000000-0000-4000-8000-000000000602',
    completed: '00000000-0000-4000-8000-000000000603',
    overdue: '00000000-0000-4000-8000-000000000604',
  },
  document: {
    van1Insurance: '00000000-0000-4000-8000-000000000701',
    van1Inspection: '00000000-0000-4000-8000-000000000702',
    truck1Insurance: '00000000-0000-4000-8000-000000000703',
    car1Registration: '00000000-0000-4000-8000-000000000704',
  },
  damage: {
    reported: '00000000-0000-4000-8000-000000000801',
  },
  mileage: {
    van1: '00000000-0000-4000-8000-000000000901',
    van2: '00000000-0000-4000-8000-000000000902',
    truck1: '00000000-0000-4000-8000-000000000903',
    car1: '00000000-0000-4000-8000-000000000904',
  },
} as const;

/** Midnight-anchored date `days` from today, so seeded states stay meaningful. */
function daysFromNow(days: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

async function seedSettings(): Promise<void> {
  // One row per top-level branch of the settings schema.
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.setting.upsert({
      where: { key },
      update: {}, // never clobber values an administrator has tuned
      create: { key, value },
    });
  }
}

async function seedReferenceData(): Promise<void> {
  const vehicleTypes = [
    { id: ID.vehicleType.van, name: 'Van', description: 'Light delivery van' },
    { id: ID.vehicleType.truck, name: 'Truck', description: 'Heavy goods vehicle' },
    { id: ID.vehicleType.car, name: 'Car', description: 'Passenger car' },
  ];
  for (const type of vehicleTypes) {
    await prisma.vehicleType.upsert({ where: { id: type.id }, update: type, create: type });
  }

  // Notice periods follow the client's agreed document default (Q4); the
  // registration renewal window is longer because the paperwork takes longer.
  const documentTypes = [
    { code: 'insurance', label: 'Insurance', defaultNoticeDays: 30 },
    { code: 'technical_inspection', label: 'Technical inspection', defaultNoticeDays: 30 },
    { code: 'registration', label: 'Registration', defaultNoticeDays: 60 },
    { code: 'road_tax', label: 'Road tax', defaultNoticeDays: 30 },
    { code: 'transport_permit', label: 'Transport permit', defaultNoticeDays: 30 },
  ];
  for (const type of documentTypes) {
    await prisma.documentType.upsert({
      where: { code: type.code },
      update: { label: type.label, defaultNoticeDays: type.defaultNoticeDays },
      create: type,
    });
  }
}

async function seedUsers(passwordHash: string): Promise<void> {
  const users = [
    { id: ID.user.admin, name: 'Aya Benali', email: 'admin@fleetflow.local', role: 'ADMIN' },
    {
      id: ID.user.manager,
      name: 'Karim Haddad',
      email: 'manager@fleetflow.local',
      role: 'FLEET_MANAGER',
    },
    {
      id: ID.user.mechanic,
      name: 'Samir Ouali',
      email: 'mechanic@fleetflow.local',
      role: 'MECHANIC',
    },
    {
      id: ID.user.accountant,
      name: 'Nadia Cherif',
      email: 'accountant@fleetflow.local',
      role: 'ACCOUNTANT',
    },
    {
      id: ID.user.driverAmina,
      name: 'Amina Toure',
      email: 'amina@fleetflow.local',
      role: 'DRIVER',
    },
    {
      id: ID.user.driverYoussef,
      name: 'Youssef Berrada',
      email: 'youssef@fleetflow.local',
      role: 'DRIVER',
    },
  ] as const;

  for (const user of users) {
    await prisma.user.upsert({
      where: { id: user.id },
      update: { name: user.name, email: user.email, role: user.role },
      create: { ...user, passwordHash },
    });
  }
}

async function seedDrivers(): Promise<void> {
  const drivers = [
    {
      id: ID.driver.amina,
      userId: ID.user.driverAmina,
      firstName: 'Amina',
      lastName: 'Toure',
      licenceNo: 'DL-2291045',
      licenceCategory: 'B',
      licenceExpiry: daysFromNow(420),
      phone: '+212 600 111 222',
      hiredAt: daysFromNow(-900),
    },
    {
      id: ID.driver.youssef,
      userId: ID.user.driverYoussef,
      firstName: 'Youssef',
      lastName: 'Berrada',
      licenceNo: 'DL-3310982',
      licenceCategory: 'C',
      licenceExpiry: daysFromNow(180),
      phone: '+212 600 333 444',
      hiredAt: daysFromNow(-540),
    },
    {
      // DRV-04 is optional: a driver need not have a login account.
      id: ID.driver.unlinked,
      userId: null,
      firstName: 'Rachid',
      lastName: 'Alaoui',
      licenceNo: 'DL-4405511',
      licenceCategory: 'B',
      licenceExpiry: daysFromNow(90),
      phone: '+212 600 555 666',
      hiredAt: daysFromNow(-200),
    },
  ];

  for (const driver of drivers) {
    await prisma.driver.upsert({ where: { id: driver.id }, update: driver, create: driver });
  }
}

async function seedVehicles(): Promise<void> {
  const vehicles = [
    {
      id: ID.vehicle.van1,
      plate: '12345-A-6',
      vin: 'WV1ZZZ7HZ8H123456',
      make: 'Renault',
      model: 'Master',
      year: 2021,
      vehicleTypeId: ID.vehicleType.van,
      status: 'ACTIVE' as const,
      currentMileage: 84_500,
      purchaseDate: daysFromNow(-1400),
      purchasePrice: '28500.00',
      insuranceValue: '19000.00',
    },
    {
      id: ID.vehicle.van2,
      plate: '22876-B-6',
      vin: 'WV1ZZZ7HZ9H778812',
      make: 'Peugeot',
      model: 'Boxer',
      year: 2022,
      vehicleTypeId: ID.vehicleType.van,
      status: 'ACTIVE' as const,
      currentMileage: 41_200,
      purchaseDate: daysFromNow(-800),
      purchasePrice: '31000.00',
      insuranceValue: '24000.00',
    },
    {
      id: ID.vehicle.truck1,
      plate: '55120-C-1',
      vin: 'YV2A4CFA6MB998877',
      make: 'Volvo',
      model: 'FL 250',
      year: 2020,
      vehicleTypeId: ID.vehicleType.truck,
      // VEH-06: currently in the workshop, which the dashboard counts separately.
      status: 'UNDER_MAINTENANCE' as const,
      currentMileage: 210_300,
      purchaseDate: daysFromNow(-1900),
      purchasePrice: '74000.00',
      insuranceValue: '52000.00',
    },
    {
      id: ID.vehicle.car1,
      plate: '77410-D-2',
      vin: 'VF7XXXXXXXX445566',
      make: 'Dacia',
      model: 'Logan',
      year: 2023,
      vehicleTypeId: ID.vehicleType.car,
      status: 'ACTIVE' as const,
      currentMileage: 18_900,
      purchaseDate: daysFromNow(-400),
      purchasePrice: '14500.00',
      insuranceValue: '12000.00',
    },
    {
      // Archived: must stay out of operational lists but remain in reports.
      id: ID.vehicle.archived,
      plate: '90001-E-9',
      vin: null,
      make: 'Fiat',
      model: 'Doblo',
      year: 2015,
      vehicleTypeId: ID.vehicleType.van,
      status: 'ARCHIVED' as const,
      currentMileage: 305_000,
      archivedAt: daysFromNow(-30),
      purchaseDate: daysFromNow(-3200),
      purchasePrice: '11000.00',
      insuranceValue: null,
    },
  ];

  for (const vehicle of vehicles) {
    await prisma.vehicle.upsert({ where: { id: vehicle.id }, update: vehicle, create: vehicle });
  }

  const readings = [
    { id: ID.mileage.van1, vehicleId: ID.vehicle.van1, mileage: 84_500 },
    { id: ID.mileage.van2, vehicleId: ID.vehicle.van2, mileage: 41_200 },
    { id: ID.mileage.truck1, vehicleId: ID.vehicle.truck1, mileage: 210_300 },
    { id: ID.mileage.car1, vehicleId: ID.vehicle.car1, mileage: 18_900 },
  ];
  for (const reading of readings) {
    await prisma.mileageReading.upsert({
      where: { id: reading.id },
      update: reading,
      create: { ...reading, recordedById: ID.user.manager },
    });
  }
}

async function seedAssignments(): Promise<void> {
  // A closed historical assignment plus an open one on the same vehicle: this
  // is the shape VEH-03 and the driver assignment history report read, and it
  // is also the case the one-open-per-vehicle index has to allow.
  const assignments = [
    {
      id: ID.assignment.van1Closed,
      vehicleId: ID.vehicle.van1,
      driverId: ID.driver.youssef,
      startDate: daysFromNow(-400),
      endDate: daysFromNow(-120),
      endedById: ID.user.manager,
    },
    {
      id: ID.assignment.van1Open,
      vehicleId: ID.vehicle.van1,
      driverId: ID.driver.amina,
      startDate: daysFromNow(-119),
      endDate: null,
    },
    {
      id: ID.assignment.truck1Open,
      vehicleId: ID.vehicle.truck1,
      driverId: ID.driver.youssef,
      startDate: daysFromNow(-60),
      endDate: null,
    },
  ];

  for (const assignment of assignments) {
    await prisma.assignment.upsert({
      where: { id: assignment.id },
      update: assignment,
      create: assignment,
    });
  }
}

async function seedMaintenance(): Promise<void> {
  const plans = [
    {
      id: ID.plan.vanService,
      name: 'Van service — every 15 000 km',
      vehicleTypeId: ID.vehicleType.van,
      vehicleId: null,
      triggerType: 'MILEAGE' as const,
      intervalDays: null,
      intervalKm: 15_000,
      noticeDays: 14,
      noticeKm: 500,
    },
    {
      id: ID.plan.truckService,
      name: 'Truck service — every 6 months or 25 000 km',
      vehicleTypeId: ID.vehicleType.truck,
      vehicleId: null,
      triggerType: 'BOTH' as const,
      intervalDays: 182,
      intervalKm: 25_000,
      noticeDays: 21,
      noticeKm: 1_000,
    },
    {
      // MNT-04 also allows a plan scoped to a single vehicle.
      id: ID.plan.car1Specific,
      name: 'Logan annual inspection',
      vehicleId: ID.vehicle.car1,
      vehicleTypeId: null,
      triggerType: 'DATE' as const,
      intervalDays: 365,
      intervalKm: null,
      noticeDays: 30,
      noticeKm: 500,
    },
  ];

  for (const plan of plans) {
    await prisma.maintenancePlan.upsert({ where: { id: plan.id }, update: plan, create: plan });
  }

  // One operation per status the board has to render (MNT-06).
  const ops = [
    {
      id: ID.op.planned,
      vehicleId: ID.vehicle.van2,
      planId: ID.plan.vanService,
      kind: 'SCHEDULED' as const,
      title: 'Oil and filter change',
      status: 'PLANNED' as const,
      dueDate: daysFromNow(12),
      dueMileage: 45_000,
      mechanicId: ID.user.mechanic,
      costParts: '0',
      costLabour: '0',
      costTotal: '0',
    },
    {
      id: ID.op.inProgress,
      vehicleId: ID.vehicle.truck1,
      planId: ID.plan.truckService,
      kind: 'SCHEDULED' as const,
      title: 'Brake system overhaul',
      status: 'IN_PROGRESS' as const,
      dueDate: daysFromNow(3),
      dueMileage: 212_000,
      startedAt: daysFromNow(-1),
      mechanicId: ID.user.mechanic,
      costParts: '640.00',
      costLabour: '260.00',
      costTotal: '900.00',
    },
    {
      id: ID.op.completed,
      vehicleId: ID.vehicle.van1,
      planId: ID.plan.vanService,
      kind: 'SCHEDULED' as const,
      title: 'Service at 75 000 km',
      status: 'COMPLETED' as const,
      dueDate: daysFromNow(-45),
      dueMileage: 75_000,
      startedAt: daysFromNow(-46),
      completedAt: daysFromNow(-45),
      completedMileage: 75_120,
      mechanicId: ID.user.mechanic,
      costParts: '310.50',
      costLabour: '180.00',
      costTotal: '490.50',
      vendor: 'Atlas Auto Services',
    },
    {
      // Past its due date and still open — what NTF-04 and the dashboard's
      // overdue counter are for.
      id: ID.op.overdue,
      vehicleId: ID.vehicle.car1,
      planId: ID.plan.car1Specific,
      kind: 'SCHEDULED' as const,
      title: 'Annual inspection',
      status: 'OVERDUE' as const,
      dueDate: daysFromNow(-9),
      dueMileage: null,
      mechanicId: null,
      costParts: '0',
      costLabour: '0',
      costTotal: '0',
    },
  ];

  for (const op of ops) {
    await prisma.maintenanceOp.upsert({ where: { id: op.id }, update: op, create: op });
  }
}

async function seedDocuments(): Promise<void> {
  const types = await prisma.documentType.findMany();
  const byCode = new Map(types.map((t) => [t.code, t.id]));

  function typeId(code: string): string {
    const id = byCode.get(code);
    if (!id) throw new Error(`Document type "${code}" is missing — seed reference data first.`);
    return id;
  }

  // Deliberately one of each DOC-05 state, so the status indicator and the
  // expiring-documents report have something to show on a fresh database.
  const documents = [
    {
      id: ID.document.van1Insurance,
      vehicleId: ID.vehicle.van1,
      documentTypeId: typeId('insurance'),
      referenceNo: 'INS-2026-0114',
      issueDate: daysFromNow(-320),
      expiryDate: daysFromNow(45), // VALID
      noticeDays: null,
    },
    {
      id: ID.document.van1Inspection,
      vehicleId: ID.vehicle.van1,
      documentTypeId: typeId('technical_inspection'),
      referenceNo: 'TI-2025-8890',
      issueDate: daysFromNow(-350),
      expiryDate: daysFromNow(11), // EXPIRING_SOON at the 30-day default
      noticeDays: null,
    },
    {
      id: ID.document.truck1Insurance,
      vehicleId: ID.vehicle.truck1,
      documentTypeId: typeId('insurance'),
      referenceNo: 'INS-2025-4471',
      issueDate: daysFromNow(-400),
      expiryDate: daysFromNow(-6), // EXPIRED
      noticeDays: null,
    },
    {
      id: ID.document.car1Registration,
      vehicleId: ID.vehicle.car1,
      documentTypeId: typeId('registration'),
      referenceNo: 'REG-2023-1188',
      issueDate: daysFromNow(-400),
      expiryDate: daysFromNow(200),
      noticeDays: 90, // per-document override of the type default
    },
  ];

  for (const doc of documents) {
    await prisma.document.upsert({ where: { id: doc.id }, update: doc, create: doc });
  }
}

async function seedDamages(): Promise<void> {
  // DMG-03: filed by a driver against the vehicle they are assigned to, which
  // is exactly the scope check FF-701 has to enforce.
  const damage = {
    id: ID.damage.reported,
    vehicleId: ID.vehicle.van1,
    reportedByUserId: ID.user.driverAmina,
    driverId: ID.driver.amina,
    description: 'Rear left door dented in a car park; door still closes and locks.',
    severity: 'LOW' as const,
    occurredAt: daysFromNow(-4),
    location: 'Casablanca depot',
    status: 'REPORTED' as const,
  };

  await prisma.damage.upsert({ where: { id: damage.id }, update: damage, create: damage });
}

async function main(): Promise<void> {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_COST);

  await seedSettings();
  await seedReferenceData();
  await seedUsers(passwordHash);
  await seedDrivers();
  await seedVehicles();
  await seedAssignments();
  await seedMaintenance();
  await seedDocuments();
  await seedDamages();

  const counts = {
    settings: await prisma.setting.count(),
    vehicleTypes: await prisma.vehicleType.count(),
    documentTypes: await prisma.documentType.count(),
    users: await prisma.user.count(),
    drivers: await prisma.driver.count(),
    vehicles: await prisma.vehicle.count(),
    assignments: await prisma.assignment.count(),
    maintenancePlans: await prisma.maintenancePlan.count(),
    maintenanceOps: await prisma.maintenanceOp.count(),
    documents: await prisma.document.count(),
    damages: await prisma.damage.count(),
  };

  console.log('Seed complete:');
  for (const [table, count] of Object.entries(counts)) {
    console.log(`  ${table.padEnd(18)} ${count}`);
  }
  console.log(`\nAll demo accounts use the password: ${DEMO_PASSWORD}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
