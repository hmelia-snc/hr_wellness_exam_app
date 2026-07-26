import { randomUUID } from "node:crypto";

/**
 * Minimal in-memory stand-in for the subset of PrismaClient that
 * importCycle() touches, so its idempotency/orchestration logic can be unit
 * tested without a live SQL Server instance.
 */
export function createFakePrisma() {
  const employeesByEmail = new Map<string, any>();
  const physicalRecords: any[] = [];
  const uploadBatches: any[] = [];

  return {
    employee: {
      async upsert({ where, create, update }: any) {
        const existing = employeesByEmail.get(where.email);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const created = { id: randomUUID(), email: where.email, ...create };
        employeesByEmail.set(where.email, created);
        return created;
      },
    },
    physicalRecord: {
      async findUnique({ where }: any) {
        if (where.employeeId_cycleYear) {
          const { employeeId, cycleYear } = where.employeeId_cycleYear;
          return physicalRecords.find((r) => r.employeeId === employeeId && r.cycleYear === cycleYear) ?? null;
        }
        if (where.tokenHash) {
          return physicalRecords.find((r) => r.tokenHash === where.tokenHash) ?? null;
        }
        if (where.id) {
          return physicalRecords.find((r) => r.id === where.id) ?? null;
        }
        throw new Error(`fakePrisma.physicalRecord.findUnique: unsupported where clause ${JSON.stringify(where)}`);
      },
      async create({ data }: any) {
        const record = { id: randomUUID(), ...data };
        physicalRecords.push(record);
        return record;
      },
      async update({ where, data }: any) {
        const record = physicalRecords.find((r) => r.id === where.id);
        Object.assign(record, data);
        return record;
      },
      async findMany({ where = {}, include, orderBy }: any = {}) {
        let results = physicalRecords.filter((r) => {
          if (where.cycleYear !== undefined && r.cycleYear !== where.cycleYear) return false;
          if (where.status !== undefined && r.status !== where.status) return false;
          return true;
        });
        if (orderBy?.createdAt === "asc") {
          results = [...results].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        } else if (orderBy?.createdAt === "desc") {
          results = [...results].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
        if (include?.employee) {
          results = results.map((r) => ({
            ...r,
            employee: [...employeesByEmail.values()].find((e) => e.id === r.employeeId) ?? null,
          }));
        }
        return results;
      },
    },
    uploadBatch: {
      async create({ data }: any) {
        const batch = { id: randomUUID(), ...data };
        uploadBatches.push(batch);
        return batch;
      },
    },
    _state: { employeesByEmail, physicalRecords, uploadBatches },
  };
}

export type FakePrisma = ReturnType<typeof createFakePrisma>;
