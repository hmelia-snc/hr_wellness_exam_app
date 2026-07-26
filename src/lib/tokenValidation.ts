import type { PrismaClient, PhysicalRecord } from "@prisma/client";
import { hashToken } from "./token.js";

export type TokenValidationResult =
  | { kind: "not_found" }
  | { kind: "expired"; record: PhysicalRecord }
  | { kind: "completed"; record: PhysicalRecord }
  | { kind: "ok"; record: PhysicalRecord };

/**
 * Looks up a PhysicalRecord by the hash of a raw token and classifies it.
 * `not_found` covers both a garbage token and a real-but-unknown one — the
 * caller shouldn't distinguish these in its response, to avoid leaking
 * whether a near-miss token exists.
 */
export async function validateToken(prisma: PrismaClient, rawToken: string): Promise<TokenValidationResult> {
  const tokenHash = hashToken(rawToken);
  const record = await prisma.physicalRecord.findUnique({ where: { tokenHash } });

  if (!record) return { kind: "not_found" };
  if (record.tokenExpiresAt.getTime() < Date.now()) return { kind: "expired", record };
  if (record.status === "completed") return { kind: "completed", record };
  return { kind: "ok", record };
}
