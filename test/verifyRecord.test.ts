import { describe, expect, it } from "vitest";
import { verifyPhysicalRecord } from "../src/services/verifyRecord.js";
import { createFakePrisma } from "./fakePrisma.js";
import { createFakeFormVerifier } from "./fakes.js";

async function seedRecord(prisma: ReturnType<typeof createFakePrisma>, overrides: Partial<Record<string, unknown>> = {}) {
  const employee = await prisma.employee.upsert({
    where: { email: "verify-test@example.com" },
    create: { email: "verify-test@example.com", fullName: "Verify Test", active: true },
    update: {},
  });
  const record = {
    id: "rec-1",
    employeeId: employee.id,
    cycleYear: 2026,
    tokenHash: "unused-hash",
    tokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
    status: "received",
    uploadedBlobPath: "uploads/2026/rec-1/original.pdf",
    receivedAt: new Date(),
    ...overrides,
  };
  prisma._state.physicalRecords.push(record);
  return record;
}

describe("verifyPhysicalRecord", () => {
  it("transitions to completed and stamps completedAt when verification passes", async () => {
    const prisma = createFakePrisma();
    const record = await seedRecord(prisma);
    const verifier = createFakeFormVerifier({ result: { passed: true, summary: "looks good" } });

    await verifyPhysicalRecord(prisma as any, verifier, record.id, record.uploadedBlobPath, Buffer.from("pdf"), "application/pdf");

    const updated = prisma._state.physicalRecords.find((r: any) => r.id === record.id);
    expect(updated.status).toBe("completed");
    expect(updated.verificationResult).toBe("looks good");
    expect(updated.completedAt).toBeInstanceOf(Date);
    expect(verifier.calls).toHaveLength(1);
  });

  it("transitions to needs_review and clears completedAt when verification fails", async () => {
    const prisma = createFakePrisma();
    const record = await seedRecord(prisma, { completedAt: new Date() });
    const verifier = createFakeFormVerifier({ result: { passed: false, summary: "no signature detected" } });

    await verifyPhysicalRecord(prisma as any, verifier, record.id, record.uploadedBlobPath, Buffer.from("pdf"), "application/pdf");

    const updated = prisma._state.physicalRecords.find((r: any) => r.id === record.id);
    expect(updated.status).toBe("needs_review");
    expect(updated.verificationResult).toBe("no signature detected");
    expect(updated.completedAt).toBeNull();
  });

  it("skips the update when a newer upload has superseded this one", async () => {
    const prisma = createFakePrisma();
    const record = await seedRecord(prisma);
    const staleBlobPath = record.uploadedBlobPath;
    const verifier = createFakeFormVerifier({ result: { passed: true, summary: "stale result" } });

    // Simulate a second upload landing before this (stale) verification resolves.
    // `current` is the same object reference `record` points to (fakePrisma
    // stores it directly), so mutating it here also changes what
    // `record.uploadedBlobPath` reads as — hence capturing staleBlobPath above.
    const current = prisma._state.physicalRecords.find((r: any) => r.id === record.id);
    current.uploadedBlobPath = "uploads/2026/rec-1/newer.pdf";
    current.status = "received";

    await verifyPhysicalRecord(prisma as any, verifier, record.id, staleBlobPath, Buffer.from("pdf"), "application/pdf");

    const updated = prisma._state.physicalRecords.find((r: any) => r.id === record.id);
    expect(updated.status).toBe("received");
    expect(updated.verificationResult).toBeUndefined();
  });

  it("logs and swallows an error instead of throwing when the verifier rejects", async () => {
    const prisma = createFakePrisma();
    const record = await seedRecord(prisma);
    const verifier = { verify: async () => { throw new Error("OCR service unavailable"); } };

    await expect(
      verifyPhysicalRecord(prisma as any, verifier, record.id, record.uploadedBlobPath, Buffer.from("pdf"), "application/pdf")
    ).resolves.toBeUndefined();

    const updated = prisma._state.physicalRecords.find((r: any) => r.id === record.id);
    expect(updated.status).toBe("received");
  });
});
