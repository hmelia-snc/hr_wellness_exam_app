import type { PrismaClient } from "@prisma/client";
import { parseEmployeeCsv, type CsvRowError } from "../lib/csv.js";
import type { EmailSender } from "../lib/email/types.js";
import { upsertEmployeeAndSendLink, upsertSpouseRecord } from "./employeeActions.js";

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
  spousesLinked: number;
  spouseLinkErrors: { line: number; message: string }[];
}

/**
 * Imports a CSV of employee and spouse rows for a physical-form cycle.
 * Two passes, since a spouse row's linked_employee_email may point at an
 * employee row earlier OR later in the same file:
 *   1. Every "employee" row goes through upsertEmployeeAndSendLink (upsert
 *      employee, create+email a fresh record unless one already exists for
 *      this cycleYear — re-running an import is a no-op for employees
 *      already in progress).
 *   2. Every "spouse" row is then resolved against linked_employee_email —
 *      against an employee just upserted in pass 1, or one already in the
 *      DB from an earlier import — via upsertSpouseRecord. A row whose
 *      linked_employee_email doesn't match any known employee is recorded
 *      in spouseLinkErrors rather than thrown, same "one bad row doesn't
 *      sink the batch" approach as the CSV parser itself.
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

  const employeeRows = rows.filter((row) => row.recordType === "employee");
  const spouseRows = rows.filter((row) => row.recordType === "spouse");

  for (const row of employeeRows) {
    const result = await upsertEmployeeAndSendLink(prisma, emailSender, {
      fullName: row.fullName,
      email: row.email!,
      employeeIdExternal: row.employeeIdExternal,
      cycleYear: options.cycleYear,
    });

    if (!result.recordCreated) {
      recordsSkippedExisting += 1;
      continue;
    }
    recordsCreated += 1;
    if (result.emailSent) {
      emailsSent += 1;
    } else if (result.emailError) {
      emailFailures.push({ email: row.email!, error: result.emailError });
    }
  }

  let spousesLinked = 0;
  const spouseLinkErrors: { line: number; message: string }[] = [];
  // Line numbers for these errors aren't tracked per-row past parsing, so
  // report them by the spouse's own name instead — still enough for HR to
  // find and fix the offending row.
  for (const row of spouseRows) {
    const linkedEmployee = await prisma.employee.findUnique({ where: { email: row.linkedEmployeeEmail } });
    if (!linkedEmployee || linkedEmployee.recordType !== "employee") {
      spouseLinkErrors.push({
        line: 0,
        message: `${row.fullName}: no employee found with email "${row.linkedEmployeeEmail}"`,
      });
      continue;
    }

    await upsertSpouseRecord(prisma, {
      fullName: row.fullName,
      email: row.email,
      employeeIdExternal: row.employeeIdExternal,
      linkedEmployeeId: linkedEmployee.id,
      cycleYear: options.cycleYear,
    });
    spousesLinked += 1;
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
    spousesLinked,
    spouseLinkErrors,
  };
}
