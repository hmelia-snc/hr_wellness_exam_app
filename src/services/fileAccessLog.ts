import type { PrismaClient } from "@prisma/client";

export type FileAccessType = "employee" | "spouse";

/**
 * Records who viewed an uploaded form and when, per the spec's audit
 * requirement. Deliberately has no FK to PhysicalRecord (see schema comment)
 * so this trail outlives a full employee purge.
 */
export async function recordFileAccess(
  prisma: PrismaClient,
  physicalRecordId: string,
  fileType: FileAccessType,
  viewedBy: string
): Promise<void> {
  await prisma.fileAccessLog.create({
    data: { physicalRecordId, fileType, viewedBy },
  });
}
