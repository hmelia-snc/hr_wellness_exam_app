import { describe, expect, it } from "vitest";
import { parseEmployeeCsv } from "../src/lib/csv.js";

describe("parseEmployeeCsv", () => {
  it("parses valid rows with full_name header", () => {
    const csv = "full_name,email,employee_id_external\nJane Doe,jane@example.com,E123\n";
    const { rows, errors } = parseEmployeeCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows).toEqual([{ recordType: "employee", fullName: "Jane Doe", email: "jane@example.com", employeeIdExternal: "E123" }]);
  });

  it("accepts the 'name' and 'employee_id' header aliases", () => {
    const csv = "name,email,employee_id\nJohn Smith,JOHN@Example.com,ext-9\n";
    const { rows, errors } = parseEmployeeCsv(csv);
    expect(errors).toHaveLength(0);
    // emails are normalized to lowercase
    expect(rows).toEqual([{ recordType: "employee", fullName: "John Smith", email: "john@example.com", employeeIdExternal: "ext-9" }]);
  });

  it("omits employeeIdExternal when not provided", () => {
    const csv = "full_name,email\nJane Doe,jane@example.com\n";
    const { rows } = parseEmployeeCsv(csv);
    expect(rows[0].employeeIdExternal).toBeUndefined();
  });

  it("collects an error for an invalid email without aborting other rows", () => {
    const csv = "full_name,email\nBad Row,not-an-email\nGood Row,good@example.com\n";
    const { rows, errors } = parseEmployeeCsv(csv);
    expect(rows).toEqual([{ recordType: "employee", fullName: "Good Row", email: "good@example.com", employeeIdExternal: undefined }]);
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(2);
    expect(errors[0].message).toMatch(/Invalid email/);
  });

  it("collects an error for a missing name", () => {
    const csv = "full_name,email\n,noname@example.com\n";
    const { rows, errors } = parseEmployeeCsv(csv);
    expect(rows).toHaveLength(0);
    expect(errors[0].message).toMatch(/Missing full_name/);
  });

  it("flags duplicate emails within the same file and keeps only the first", () => {
    const csv = "full_name,email\nFirst,dup@example.com\nSecond,dup@example.com\n";
    const { rows, errors } = parseEmployeeCsv(csv);
    expect(rows).toEqual([{ recordType: "employee", fullName: "First", email: "dup@example.com", employeeIdExternal: undefined }]);
    expect(errors[0].message).toMatch(/Duplicate email/);
  });

  it("silently ignores a leftover needs_spouse_form column from an older CSV format", () => {
    // The legacy embedded-spouse model (and its needs_spouse_form import
    // column) has been removed — an old CSV that still has this column
    // shouldn't error, it should just be a no-op extra column.
    const csv = "full_name,email,needs_spouse_form\nJane Doe,jane@example.com,yes\n";
    const { rows, errors } = parseEmployeeCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows).toEqual([{ recordType: "employee", fullName: "Jane Doe", email: "jane@example.com", employeeIdExternal: undefined }]);
  });

  it("defaults record_type to employee when the column is absent", () => {
    const csv = "full_name,email\nJane Doe,jane@example.com\n";
    const { rows } = parseEmployeeCsv(csv);
    expect(rows[0].recordType).toBe("employee");
  });

  it("parses a spouse row linked to an employee by email, without requiring its own email", () => {
    const csv =
      "record_type,full_name,email,linked_employee_email\nemployee,Jane Doe,jane@example.com,\nspouse,John Doe,,JANE@example.com\n";
    const { rows, errors } = parseEmployeeCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows).toEqual([
      { recordType: "employee", fullName: "Jane Doe", email: "jane@example.com", employeeIdExternal: undefined },
      {
        recordType: "spouse",
        fullName: "John Doe",
        email: undefined,
        employeeIdExternal: undefined,
        linkedEmployeeEmail: "jane@example.com",
      },
    ]);
  });

  it("accepts a spouse row with its own email too", () => {
    const csv = "record_type,full_name,email,linked_employee_email\nspouse,John Doe,john@example.com,jane@example.com\n";
    const { rows, errors } = parseEmployeeCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows[0].email).toBe("john@example.com");
  });

  it("collects an error for a spouse row missing linked_employee_email", () => {
    const csv = "record_type,full_name\nspouse,John Doe\n";
    const { rows, errors } = parseEmployeeCsv(csv);
    expect(rows).toHaveLength(0);
    expect(errors[0].message).toMatch(/Missing linked_employee_email/);
  });

  it("collects an error for an invalid record_type", () => {
    const csv = "record_type,full_name,email\nchild,Jane Doe,jane@example.com\n";
    const { rows, errors } = parseEmployeeCsv(csv);
    expect(rows).toHaveLength(0);
    expect(errors[0].message).toMatch(/Invalid record_type/);
  });
});
