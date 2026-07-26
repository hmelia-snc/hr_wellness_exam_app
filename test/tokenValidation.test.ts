import { describe, expect, it } from "vitest";
import { validateToken } from "../src/lib/tokenValidation.js";
import { generateToken } from "../src/lib/token.js";
import { createFakePrisma } from "./fakePrisma.js";

function daysFromNow(days: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

async function seedEmployee(prisma: ReturnType<typeof createFakePrisma>, email: string) {
  return prisma.employee.upsert({
    where: { email },
    create: { email, fullName: "Test Employee", active: true },
    update: {},
  });
}

describe("validateToken", () => {
  it("returns not_found for an unknown token", async () => {
    const prisma = createFakePrisma();
    const result = await validateToken(prisma as any, "some-made-up-token");
    expect(result.kind).toBe("not_found");
  });

  it("returns ok for a valid, unexpired, non-completed record", async () => {
    const prisma = createFakePrisma();
    const employee = await seedEmployee(prisma, "rec-1@example.com");
    const { rawToken, tokenHash } = generateToken();
    prisma._state.physicalRecords.push({
      id: "rec-1",
      employeeId: employee.id,
      tokenHash,
      tokenExpiresAt: daysFromNow(10),
      status: "sent",
      cycleYear: 2026,
    });

    const result = await validateToken(prisma as any, rawToken);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.record.id).toBe("rec-1");
      expect(result.employee.id).toBe(employee.id);
    }
  });

  it("returns expired when tokenExpiresAt is in the past, even if status is still sent", async () => {
    const prisma = createFakePrisma();
    const employee = await seedEmployee(prisma, "rec-2@example.com");
    const { rawToken, tokenHash } = generateToken();
    prisma._state.physicalRecords.push({
      id: "rec-2",
      employeeId: employee.id,
      tokenHash,
      tokenExpiresAt: daysFromNow(-1),
      status: "sent",
      cycleYear: 2026,
    });

    const result = await validateToken(prisma as any, rawToken);
    expect(result.kind).toBe("expired");
  });

  it("returns completed when status is completed, regardless of expiry", async () => {
    const prisma = createFakePrisma();
    const employee = await seedEmployee(prisma, "rec-3@example.com");
    const { rawToken, tokenHash } = generateToken();
    prisma._state.physicalRecords.push({
      id: "rec-3",
      employeeId: employee.id,
      tokenHash,
      tokenExpiresAt: daysFromNow(10),
      status: "completed",
      cycleYear: 2026,
    });

    const result = await validateToken(prisma as any, rawToken);
    expect(result.kind).toBe("completed");
  });

  it("returns ok for received and needs_review statuses (upload still allowed)", async () => {
    const prisma = createFakePrisma();
    for (const status of ["received", "needs_review"]) {
      const employee = await seedEmployee(prisma, `rec-${status}@example.com`);
      const { rawToken, tokenHash } = generateToken();
      prisma._state.physicalRecords.push({
        id: `rec-${status}`,
        employeeId: employee.id,
        tokenHash,
        tokenExpiresAt: daysFromNow(10),
        status,
        cycleYear: 2026,
      });
      const result = await validateToken(prisma as any, rawToken);
      expect(result.kind).toBe("ok");
    }
  });
});
