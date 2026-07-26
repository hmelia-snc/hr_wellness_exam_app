import type { PrismaClient } from "@prisma/client";
import { parseEmployeeCsv, type CsvRowError } from "../lib/csv.js";
import { generateToken, tokenExpiryDate } from "../lib/token.js";
import type { EmailSender } from "../lib/email/types.js";
import { getEnv } from "../config/env.js";

export interface ImportCycleOptions {
  csvContent: string;
  cycleYear: number;
  uploadedBy: string;
}

export interface ImportCycleResult {
  rowErrors: CsvRowError[];
  employeesSeen: number;
  recordsCreated: number;
  recordsSkippedExisting: number;
  emailsSent: number;
  emailFailures: { email: string; error: string }[];
}

/**
 * Imports a CSV of employees for a physical-form cycle:
 *   1. Upsert each employee by email.
 *   2. Create a PhysicalRecord (with a fresh token) for any employee who
 *      doesn't already have one for this cycleYear — existing records for
 *      the year are left untouched, so re-running an import is a no-op for
 *      employees already in progress.
 *   3. Record the batch.
 *   4. Email the unique link to every newly created record and mark it `sent`.
 */
export async function importCycle(
  prisma: PrismaClient,
  emailSender: EmailSender,
  options: ImportCycleOptions
): Promise<ImportCycleResult> {
  const { rows, errors: rowErrors } = parseEmployeeCsv(options.csvContent);
  const env = getEnv();

  let recordsCreated = 0;
  let recordsSkippedExisting = 0;

  const newlyCreated: { recordId: string; rawToken: string; email: string; fullName: string }[] = [];

  for (const row of rows) {
    const employee = await prisma.employee.upsert({
      where: { email: row.email },
      create: {
        email: row.email,
        fullName: row.fullName,
        employeeIdExternal: row.employeeIdExternal,
        active: true,
      },
      update: {
        fullName: row.fullName,
        employeeIdExternal: row.employeeIdExternal,
        active: true,
      },
    });

    const existingRecord = await prisma.physicalRecord.findUnique({
      where: { employeeId_cycleYear: { employeeId: employee.id, cycleYear: options.cycleYear } },
    });

    if (existingRecord) {
      recordsSkippedExisting += 1;
      continue;
    }

    const { rawToken, tokenHash } = generateToken();
    const now = new Date();
    const record = await prisma.physicalRecord.create({
      data: {
        employeeId: employee.id,
        cycleYear: options.cycleYear,
        tokenHash,
        tokenExpiresAt: tokenExpiryDate(now, env.TOKEN_EXPIRY_DAYS),
        status: "sent",
      },
    });
    recordsCreated += 1;
    newlyCreated.push({ recordId: record.id, rawToken, email: employee.email, fullName: employee.fullName });
  }

  await prisma.uploadBatch.create({
    data: { uploadedBy: options.uploadedBy, rowCount: rows.length },
  });

  let emailsSent = 0;
  const emailFailures: { email: string; error: string }[] = [];

  for (const created of newlyCreated) {
    const link = `${env.APP_BASE_URL}/physical/${created.rawToken}`;
    try {
      await emailSender.send({
        toEmail: created.email,
        toName: created.fullName,
        link,
        cycleYear: options.cycleYear,
      });
      await prisma.physicalRecord.update({
        where: { id: created.recordId },
        data: { sentAt: new Date() },
      });
      emailsSent += 1;
    } catch (err) {
      emailFailures.push({ email: created.email, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return {
    rowErrors,
    employeesSeen: rows.length,
    recordsCreated,
    recordsSkippedExisting,
    emailsSent,
    emailFailures,
  };
}
