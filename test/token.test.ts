import { describe, expect, it } from "vitest";
import { generateToken, hashToken, tokenExpiryDate } from "../src/lib/token.js";

describe("token", () => {
  it("generates a raw token whose hash matches tokenHash", () => {
    const { rawToken, tokenHash } = generateToken();
    expect(hashToken(rawToken)).toBe(tokenHash);
  });

  it("generates unique tokens across calls", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a.rawToken).not.toBe(b.rawToken);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });

  it("hashing is deterministic and one-way-looking (not equal to input)", () => {
    const raw = "some-raw-token-value";
    const hash1 = hashToken(raw);
    const hash2 = hashToken(raw);
    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(raw);
  });

  it("computes an expiry date N days out in UTC", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const expires = tokenExpiryDate(from, 30);
    expect(expires.toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });
});
