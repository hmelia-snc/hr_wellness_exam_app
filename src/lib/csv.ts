import { parse } from "csv-parse/sync";
import { z } from "zod";

export interface EmployeeCsvRow {
  fullName: string;
  email: string;
  employeeIdExternal?: string;
  needsSpouseForm?: boolean;
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
  full_name: z.string().optional(),
  name: z.string().optional(),
  email: z.string().optional(),
  employee_id_external: z.string().optional(),
  employee_id: z.string().optional(),
  needs_spouse_form: z.string().optional(),
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

    const fullName = (parsed.data.full_name || parsed.data.name)?.trim();
    if (!fullName) {
      errors.push({ line, message: "Missing full_name/name" });
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

    const employeeIdExternal =
      (parsed.data.employee_id_external || parsed.data.employee_id)?.trim() || undefined;
    const needsSpouseForm = parseNeedsSpouseForm(parsed.data.needs_spouse_form);

    rows.push({ fullName, email, employeeIdExternal, needsSpouseForm });
  });

  return { rows, errors };
}
