import type { PrismaClient } from "@prisma/client";
import { parseEmployeeCsv, type CsvRowError } from "../lib/csv.js";
import type { EmailSender } from "../lib/email/types.js";
import { upsertEmployeeAndSendLink } from "./employeeActions.js";

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
 * Imports a CSV of employees for a physical-form cycle: each row goes
 * through upsertEmployeeAndSendLink (upsert employee, create+email a fresh
 * record unless one already exists for this cycleYear — re-running an
 * import is a no-op for employees already in progress), then the batch is
 * recorded.
 */
export async function importCycle(
  prisma: PrismaClient,
  emailSender: EmailSender,
  options: ImportCycleOptions
): Promise<ImportCycleResult> {
  const { rows, errors: rowErrors } = parseEmployeeCsv(options.csvContent);

  let recordsCreated = 0;
  let recordsSkippedExisting = 0;
  let emailsSent = 0;
  const emailFailures: { email: string; error: string }[] = [];

  for (const row of rows) {
    const result = await upsertEmployeeAndSendLink(prisma, emailSender, {
      fullName: row.fullName,
      email: row.email,
      employeeIdExternal: row.employeeIdExternal,
      cycleYear: options.cycleYear,
      needsSpouseForm: row.needsSpouseForm,
    });

    if (!result.recordCreated) {
      recordsSkippedExisting += 1;
      continue;
    }
    recordsCreated += 1;
    if (result.emailSent) {
      emailsSent += 1;
    } else if (result.emailError) {
      emailFailures.push({ email: row.email, error: result.emailError });
    }
  }

  await prisma.uploadBatch.create({
    data: { uploadedBy: options.uploadedBy, rowCount: rows.length },
  });

  return {
    rowErrors,
    employeesSeen: rows.length,
    recordsCreated,
    recordsSkippedExisting,
    emailsSent,
    emailFailures,
  };
}
