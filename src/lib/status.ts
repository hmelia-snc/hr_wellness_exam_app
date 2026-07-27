// Application-level enum standing in for a DB enum: Prisma's sqlserver
// connector has no native enum type, so `physical_records.status` is a plain
// column constrained here instead.
export const PHYSICAL_RECORD_STATUSES = [
  "sent",
  "received",
  "needs_review",
  "rejected",
  "completed",
] as const;

export type PhysicalRecordStatus = (typeof PHYSICAL_RECORD_STATUSES)[number];
