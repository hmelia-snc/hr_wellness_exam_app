import { describe, expect, it } from "vitest";
import { importCycle } from "../src/services/importCycle.js";
import { createFakePrisma } from "./fakePrisma.js";
import { createFakeEmailSender as fakeEmailSender } from "./fakes.js";

const CSV = "full_name,email\nJane Doe,jane@example.com\nJohn Smith,john@example.com\n";

describe("importCycle", () => {
  it("creates an employee + physical record per CSV row and emails each one", async () => {
    const prisma = createFakePrisma();
    const sender = fakeEmailSender();

    const result = await importCycle(prisma as any, sender, {
      csvContent: CSV,
      cycleYear: 2026,
      uploadedBy: "hr-admin",
    });

    expect(result.employeesSeen).toBe(2);
    expect(result.recordsCreated).toBe(2);
    expect(result.recordsSkippedExisting).toBe(0);
    expect(result.emailsSent).toBe(2);
    expect(sender.sent.map((e) => e.toEmail).sort()).toEqual(["jane@example.com", "john@example.com"]);

    const records = prisma._state.physicalRecords;
    expect(records).toHaveLength(2);
    for (const record of records) {
      expect(record.status).toBe("sent");
      expect(record.sentAt).toBeInstanceOf(Date);
      expect(record.tokenHash).toEqual(expect.any(String));
      expect(record.cycleYear).toBe(2026);
    }
    expect(prisma._state.uploadBatches).toHaveLength(1);
    expect(prisma._state.uploadBatches[0]).toMatchObject({ uploadedBy: "hr-admin", rowCount: 2 });
  });

  it("is idempotent: re-running the same cycle/year skips existing records and doesn't resend email", async () => {
    const prisma = createFakePrisma();
    const sender = fakeEmailSender();

    await importCycle(prisma as any, sender, { csvContent: CSV, cycleYear: 2026, uploadedBy: "hr-admin" });
    const secondRun = await importCycle(prisma as any, sender, {
      csvContent: CSV,
      cycleYear: 2026,
      uploadedBy: "hr-admin",
    });

    expect(secondRun.recordsCreated).toBe(0);
    expect(secondRun.recordsSkippedExisting).toBe(2);
    expect(secondRun.emailsSent).toBe(0);
    expect(prisma._state.physicalRecords).toHaveLength(2); // still just the originals
    expect(sender.sent).toHaveLength(2); // only sent once each, from the first run
  });

  it("creates a new record for a different cycleYear even if one already exists", async () => {
    const prisma = createFakePrisma();
    const sender = fakeEmailSender();

    await importCycle(prisma as any, sender, { csvContent: CSV, cycleYear: 2026, uploadedBy: "hr-admin" });
    const nextYear = await importCycle(prisma as any, sender, {
      csvContent: CSV,
      cycleYear: 2027,
      uploadedBy: "hr-admin",
    });

    expect(nextYear.recordsCreated).toBe(2);
    expect(prisma._state.physicalRecords).toHaveLength(4);
  });

  it("leaves sentAt unset and reports a failure when the email send throws", async () => {
    const prisma = createFakePrisma();
    const sender = fakeEmailSender({ failFor: new Set(["jane@example.com"]) });

    const result = await importCycle(prisma as any, sender, {
      csvContent: CSV,
      cycleYear: 2026,
      uploadedBy: "hr-admin",
    });

    expect(result.recordsCreated).toBe(2);
    expect(result.emailsSent).toBe(1);
    expect(result.emailFailures).toEqual([{ email: "jane@example.com", error: "simulated send failure" }]);

    const janeRecord = prisma._state.physicalRecords.find(
      (r: any) => r.employeeId === prisma._state.employeesByEmail.get("jane@example.com").id
    );
    expect(janeRecord.sentAt).toBeUndefined();
  });

  it("surfaces CSV row errors without blocking valid rows", async () => {
    const prisma = createFakePrisma();
    const sender = fakeEmailSender();
    const csvWithBadRow = "full_name,email\nJane Doe,jane@example.com\nBad Row,not-an-email\n";

    const result = await importCycle(prisma as any, sender, {
      csvContent: csvWithBadRow,
      cycleYear: 2026,
      uploadedBy: "hr-admin",
    });

    expect(result.rowErrors).toHaveLength(1);
    expect(result.employeesSeen).toBe(1);
    expect(result.recordsCreated).toBe(1);
  });

  it("passes needs_spouse_form through to the created employee", async () => {
    const prisma = createFakePrisma();
    const sender = fakeEmailSender();
    const csvWithSpouseFlag =
      "full_name,email,needs_spouse_form\nJane Doe,jane@example.com,yes\nJohn Smith,john@example.com,\n";

    await importCycle(prisma as any, sender, { csvContent: csvWithSpouseFlag, cycleYear: 2026, uploadedBy: "hr-admin" });

    expect(prisma._state.employeesByEmail.get("jane@example.com").needsSpouseForm).toBe(true);
    expect(prisma._state.employeesByEmail.get("john@example.com").needsSpouseForm).toBe(false);
  });
});
