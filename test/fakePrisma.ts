import { randomUUID } from "node:crypto";

/**
 * Minimal in-memory stand-in for the subset of PrismaClient that the
 * services/routes touch, so their orchestration logic can be unit tested
 * without a live SQL Server instance.
 *
 * Employees are stored in a plain array (not keyed by email) since a spouse
 * roster record (recordType "spouse") commonly has no email at all.
 */
export function createFakePrisma() {
  const employees: any[] = [];
  const physicalRecords: any[] = [];
  const uploadBatches: any[] = [];
  const fileAccessLogs: any[] = [];

  function findEmployee(where: any): any {
    if (where.id !== undefined) return employees.find((e) => e.id === where.id) ?? null;
    if (where.email !== undefined) return employees.find((e) => e.email === where.email) ?? null;
    if (where.linkedEmployeeId !== undefined) return employees.find((e) => e.linkedEmployeeId === where.linkedEmployeeId) ?? null;
    return null;
  }

  const api: any = {
    employee: {
      async upsert({ where, create, update }: any) {
        const existing = findEmployee(where);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const created = {
          id: randomUUID(),
          active: true,
          recordType: "employee",
          linkedEmployeeId: null,
          email: where.email ?? null,
          ...create,
        };
        employees.push(created);
        return created;
      },
      async create({ data }: any) {
        const created = {
          id: randomUUID(),
          active: true,
          recordType: "employee",
          linkedEmployeeId: null,
          email: null,
          ...data,
        };
        employees.push(created);
        return created;
      },
      async findUnique({ where }: any) {
        if (where.id !== undefined || where.email !== undefined || where.linkedEmployeeId !== undefined) {
          return findEmployee(where);
        }
        throw new Error(`fakePrisma.employee.findUnique: unsupported where clause ${JSON.stringify(where)}`);
      },
      async findFirst({ where = {} }: any = {}) {
        return (
          employees.find((e) => {
            if (where.recordType !== undefined && e.recordType !== where.recordType) return false;
            if (where.linkedEmployeeId !== undefined && e.linkedEmployeeId !== where.linkedEmployeeId) return false;
            if (where.active !== undefined && e.active !== where.active) return false;
            if (where.id !== undefined && e.id !== where.id) return false;
            if (where.email !== undefined && e.email !== where.email) return false;
            if (where.employeeIdExternal !== undefined && e.employeeIdExternal !== where.employeeIdExternal) return false;
            return true;
          }) ?? null
        );
      },
      async update({ where, data }: any) {
        const employee = findEmployee(where);
        if (!employee) throw new Error(`fakePrisma.employee.update: no employee matching ${JSON.stringify(where)}`);
        Object.assign(employee, data);
        return employee;
      },
      async findMany({ where = {}, include, select, orderBy }: any = {}) {
        let results = employees.filter((e) => {
          if (where.recordType !== undefined && e.recordType !== where.recordType) return false;
          if (where.active !== undefined && e.active !== where.active) return false;
          return true;
        });
        if (orderBy?.fullName === "asc") {
          results = [...results].sort((a, b) => a.fullName.localeCompare(b.fullName));
        } else if (orderBy?.fullName === "desc") {
          results = [...results].sort((a, b) => b.fullName.localeCompare(a.fullName));
        }
        if (include?.linkedEmployee) {
          results = results.map((e) => ({
            ...e,
            linkedEmployee: e.linkedEmployeeId ? (employees.find((x) => x.id === e.linkedEmployeeId) ?? null) : null,
          }));
        }
        if (include?.spouseRecords) {
          results = results.map((e) => ({
            ...e,
            spouseRecords: employees.filter((x) => x.linkedEmployeeId === e.id),
          }));
        }
        if (select) {
          const fields = Object.keys(select).filter((key) => select[key]);
          results = results.map((e) => Object.fromEntries(fields.map((field) => [field, e[field]])));
        }
        return results;
      },
      async delete({ where }: any) {
        const idx = employees.findIndex((e) => e.id === where.id);
        if (idx === -1) throw new Error(`fakePrisma.employee.delete: no employee with id ${where.id}`);
        const [removed] = employees.splice(idx, 1);
        return removed;
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
      async findMany({ where = {}, include, orderBy, select, distinct }: any = {}) {
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
        if (Array.isArray(distinct)) {
          const seen = new Set<unknown>();
          results = results.filter((r) => {
            const key = distinct.map((field: string) => r[field]).join("|");
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        }
        if (include?.employee) {
          results = results.map((r) => {
            const emp = employees.find((e) => e.id === r.employeeId) ?? null;
            let employee = emp;
            if (emp) {
              const extra: Record<string, unknown> = {};
              if (include.employee?.include?.linkedEmployee) {
                extra.linkedEmployee = emp.linkedEmployeeId ? (employees.find((x) => x.id === emp.linkedEmployeeId) ?? null) : null;
              }
              if (include.employee?.include?.spouseRecords) {
                extra.spouseRecords = employees.filter((x) => x.linkedEmployeeId === emp.id);
              }
              if (Object.keys(extra).length > 0) employee = { ...emp, ...extra };
            }
            return { ...r, employee };
          });
        }
        if (select) {
          const fields = Object.keys(select).filter((key) => select[key]);
          results = results.map((r) => Object.fromEntries(fields.map((field) => [field, r[field]])));
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
  };

  Object.defineProperty(api, "_state", {
    get() {
      return {
        employees,
        employeesByEmail: new Map(employees.filter((e) => e.email).map((e) => [e.email, e])),
        physicalRecords,
        uploadBatches,
        fileAccessLogs,
      };
    },
  });

  return api;
}

export type FakePrisma = ReturnType<typeof createFakePrisma>;
