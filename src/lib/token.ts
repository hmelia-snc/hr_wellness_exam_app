import { randomBytes, createHash } from "node:crypto";

export interface GeneratedToken {
  /** Raw token — embed in the employee's link, never persist this value. */
  rawToken: string;
  /** SHA-256 hash of rawToken — this is what gets stored in the DB. */
  tokenHash: string;
}

export function generateToken(): GeneratedToken {
  const rawToken = randomBytes(32).toString("base64url");
  return { rawToken, tokenHash: hashToken(rawToken) };
}

export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function tokenExpiryDate(fromDate: Date, expiryDays: number): Date {
  const expires = new Date(fromDate);
  expires.setUTCDate(expires.getUTCDate() + expiryDays);
  return expires;
}
