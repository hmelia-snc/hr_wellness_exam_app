// Application-level enum standing in for a DB enum, same reasoning as
// src/lib/status.ts: Prisma's sqlserver connector has no native enum type,
// so `employees.recordType` is a plain column constrained here instead.
export const RECORD_TYPES = ["employee", "spouse"] as const;

export type RecordType = (typeof RECORD_TYPES)[number];
