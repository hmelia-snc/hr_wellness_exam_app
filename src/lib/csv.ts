import { parse } from "csv-parse/sync";
import { z } from "zod";

export interface EmployeeCsvRow {
  // "employee" (default, when the column is absent) or "spouse". A spouse
  // row is linked back to an employee row via employeeIdExternal instead
  // of getting its own upload link/email.
  recordType: "employee" | "spouse";
  fullName: string;
  // Required for an "employee" row; optional for a "spouse" row, which
  // commonly has none.
  email?: string;
  // Dual meaning depending on recordType, matching the CSV's single
  // employee_id_external column:
  //   - "employee" row: this employee's own external ID (optional).
  //   - "spouse" row: required — the external ID of the employee row this
  //     spouse should be linked to. Never stored as the spouse's own
  //     external ID (spouses don't have one in this model).
  employeeIdExternal?: string;
}

export interface CsvRowError {
  line: number;
  message: string;
}

export interface CsvParseResult {
  rows: EmployeeCsvRow[];
  errors: CsvRowError[];
}

const rawRowSchema = z.object({
  record_type: z.string().optional(),
  full_name: z.string().optional(),
  name: z.string().optional(),
  email: z.string().optional(),
  employee_id_external: z.string().optional(),
  employee_id: z.string().optional(),
});

/**
 * Parses a CSV of employees. Accepts either "full_name" or "name", and
 * either "employee_id_external" or "employee_id" as header aliases.
 * Collects per-row errors (bad email, missing name, duplicate email within
 * the file) instead of throwing, so one bad row doesn't sink the batch.
 */
export function parseEmployeeCsv(csvContent: string): CsvParseResult {
  const records: Record<string, string>[] = parse(csvContent, {
    columns: (header: string[]) =>
      header.map((column) => column.trim().toLowerCase().replace(/\s+/g, "_")),
    skip_empty_lines: true,
    trim: true,
  });

  const rows: EmployeeCsvRow[] = [];
  const errors: CsvRowError[] = [];
  const seenEmails = new Set<string>();

  records.forEach((record, index) => {
    const line = index + 2; // +1 for 0-index, +1 for the header row
    const parsed = rawRowSchema.safeParse(record);
    if (!parsed.success) {
      errors.push({ line, message: parsed.error.issues.map((i) => i.message).join("; ") });
      return;
    }

    const recordTypeRaw = (parsed.data.record_type || "employee").trim().toLowerCase();
    if (recordTypeRaw !== "employee" && recordTypeRaw !== "spouse") {
      errors.push({ line, message: `Invalid record_type: "${parsed.data.record_type}" (must be "employee" or "spouse")` });
      return;
    }
    const recordType = recordTypeRaw;

    const fullName = (parsed.data.full_name || parsed.data.name)?.trim();
    if (!fullName) {
      errors.push({ line, message: "Missing full_name/name" });
      return;
    }

    // A spouse row's own email is optional (it never gets independent
    // link/email delivery), but it must instead name which employee it
    // belongs to — via employee_id_external, holding that employee's own
    // external ID rather than anything of the spouse's own.
    if (recordType === "spouse") {
      const linkedExternalId = (parsed.data.employee_id_external || parsed.data.employee_id)?.trim();
      if (!linkedExternalId) {
        errors.push({ line, message: "Missing employee_id_external for a spouse row" });
        return;
      }

      let email: string | undefined;
      const rawEmail = parsed.data.email?.trim();
      if (rawEmail) {
        const emailResult = z.string().trim().toLowerCase().email().safeParse(rawEmail);
        if (!emailResult.success) {
          errors.push({ line, message: `Invalid email: "${rawEmail}"` });
          return;
        }
        email = emailResult.data;
        if (seenEmails.has(email)) {
          errors.push({ line, message: `Duplicate email in file, skipped: "${email}"` });
          return;
        }
        seenEmails.add(email);
      }

      rows.push({
        recordType: "spouse",
        fullName,
        email,
        employeeIdExternal: linkedExternalId,
      });
      return;
    }

    const employeeIdExternal = (parsed.data.employee_id_external || parsed.data.employee_id)?.trim() || undefined;

    const emailResult = z.string().trim().toLowerCase().email().safeParse(parsed.data.email);
    if (!emailResult.success) {
      errors.push({ line, message: `Invalid email: "${parsed.data.email ?? ""}"` });
      return;
    }
    const email = emailResult.data;

    if (seenEmails.has(email)) {
      errors.push({ line, message: `Duplicate email in file, skipped: "${email}"` });
      return;
    }
    seenEmails.add(email);

    rows.push({ recordType: "employee", fullName, email, employeeIdExternal });
  });

  return { rows, errors };
}

/** Wraps in quotes (doubling any embedded quote) whenever a value contains a comma, quote, or newline. */
export function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function buildCsv(headers: string[], rows: string[][]): string {
  return [headers, ...rows].map((row) => row.map(csvField).join(",")).join("\n") + "\n";
}
