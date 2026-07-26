import type { PrismaClient, PhysicalRecord, Employee } from "@prisma/client";
import { hashToken } from "./token.js";

export type TokenValidationResult =
  | { kind: "not_found" }
  | { kind: "expired"; record: PhysicalRecord }
  | { kind: "completed"; record: PhysicalRecord; employee: Employee }
  | { kind: "ok"; record: PhysicalRecord; employee: Employee };

/**
 * Looks up a PhysicalRecord by the hash of a raw token and classifies it.
 * `not_found` covers both a garbage token and a real-but-unknown one — the
 * caller shouldn't distinguish these in its response, to avoid leaking
 * whether a near-miss token exists. The `ok`/`completed` kinds also load the
 * related employee, since the upload page needs `needsSpouseForm` to decide
 * whether to show the spouse's file slot.
 */
export async function validateToken(prisma: PrismaClient, rawToken: string): Promise<TokenValidationResult> {
  const tokenHash = hashToken(rawToken);
  const record = await prisma.physicalRecord.findUnique({ where: { tokenHash } });

  if (!record) return { kind: "not_found" };
  if (record.tokenExpiresAt.getTime() < Date.now()) return { kind: "expired", record };

  const employee = await prisma.employee.findUnique({ where: { id: record.employeeId } });
  if (!employee) return { kind: "not_found" };

  if (record.status === "completed") return { kind: "completed", record, employee };
  return { kind: "ok", record, employee };
}
