import { parse } from "csv-parse/sync";
import { z } from "zod";

export interface EmployeeCsvRow {
  // "employee" (default, when the column is absent — every pre-existing CSV
  // keeps working unchanged) or "spouse". A spouse row is linked back to an
  // employee row via linkedEmployeeEmail instead of getting its own upload
  // link/email.
  recordType: "employee" | "spouse";
  fullName: string;
  // Required for an "employee" row; optional for a "spouse" row, which
  // commonly has none.
  email?: string;
  employeeIdExternal?: string;
  needsSpouseForm?: boolean;
  // Only set (and required) on a "spouse" row: the email of the employee
  // row it should be linked to.
  linkedEmployeeEmail?: string;
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
  needs_spouse_form: z.string().optional(),
  linked_employee_email: z.string().optional(),
});

const TRUTHY_VALUES = new Set(["true", "yes", "y", "1", "x"]);

/**
 * Column absent from the file entirely -> undefined (don't touch an existing
 * value on re-import). Present but empty or a falsy word -> false. Anything
 * else recognizable as truthy -> true.
 */
function parseNeedsSpouseForm(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  return TRUTHY_VALUES.has(raw.trim().toLowerCase());
}

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

    const employeeIdExternal =
      (parsed.data.employee_id_external || parsed.data.employee_id)?.trim() || undefined;

    // A spouse row's own email is optional (it never gets independent
    // link/email delivery), but it must instead name which employee it
    // belongs to via linked_employee_email.
    if (recordType === "spouse") {
      const rawLinkedEmail = parsed.data.linked_employee_email?.trim();
      if (!rawLinkedEmail) {
        errors.push({ line, message: "Missing linked_employee_email for a spouse row" });
        return;
      }
      const linkedEmailResult = z.string().trim().toLowerCase().email().safeParse(rawLinkedEmail);
      if (!linkedEmailResult.success) {
        errors.push({ line, message: `Invalid linked_employee_email: "${rawLinkedEmail}"` });
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
        employeeIdExternal,
        linkedEmployeeEmail: linkedEmailResult.data,
      });
      return;
    }

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

    const needsSpouseForm = parseNeedsSpouseForm(parsed.data.needs_spouse_form);

    rows.push({ recordType: "employee", fullName, email, employeeIdExternal, needsSpouseForm });
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
