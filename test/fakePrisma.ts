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
  const fileAccessLogs: any[] = [];

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
      async findUnique({ where }: any) {
        if (where.id) {
          return [...employeesByEmail.values()].find((e) => e.id === where.id) ?? null;
        }
        if (where.email) {
          return employeesByEmail.get(where.email) ?? null;
        }
        throw new Error(`fakePrisma.employee.findUnique: unsupported where clause ${JSON.stringify(where)}`);
      },
      async update({ where, data }: any) {
        const employee = [...employeesByEmail.values()].find((e) => e.id === where.id);
        if (!employee) throw new Error(`fakePrisma.employee.update: no employee with id ${where.id}`);
        Object.assign(employee, data);
        return employee;
      },
      async findMany() {
        return [...employeesByEmail.values()];
      },
      async delete({ where }: any) {
        const employee = [...employeesByEmail.entries()].find(([, e]) => e.id === where.id);
        if (!employee) throw new Error(`fakePrisma.employee.delete: no employee with id ${where.id}`);
        employeesByEmail.delete(employee[0]);
        return employee[1];
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
          if (where.employeeId !== undefined && r.employeeId !== where.employeeId) return false;
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
      async deleteMany({ where = {} }: any = {}) {
        const toDelete = physicalRecords.filter((r) => where.employeeId === undefined || r.employeeId === where.employeeId);
        for (const record of toDelete) {
          const index = physicalRecords.indexOf(record);
          if (index !== -1) physicalRecords.splice(index, 1);
        }
        return { count: toDelete.length };
      },
    },
    uploadBatch: {
      async create({ data }: any) {
        const batch = { id: randomUUID(), ...data };
        uploadBatches.push(batch);
        return batch;
      },
    },
    fileAccessLog: {
      async create({ data }: any) {
        const log = { id: randomUUID(), viewedAt: new Date(), ...data };
        fileAccessLogs.push(log);
        return log;
      },
    },
    _state: { employeesByEmail, physicalRecords, uploadBatches, fileAccessLogs },
  };
}

export type FakePrisma = ReturnType<typeof createFakePrisma>;
