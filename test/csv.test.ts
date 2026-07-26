import { describe, expect, it } from "vitest";
import { parseEmployeeCsv } from "../src/lib/csv.js";

describe("parseEmployeeCsv", () => {
  it("parses valid rows with full_name header", () => {
    const csv = "full_name,email,employee_id_external\nJane Doe,jane@example.com,E123\n";
    const { rows, errors } = parseEmployeeCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows).toEqual([{ fullName: "Jane Doe", email: "jane@example.com", employeeIdExternal: "E123" }]);
  });

  it("accepts the 'name' and 'employee_id' header aliases", () => {
    const csv = "name,email,employee_id\nJohn Smith,JOHN@Example.com,ext-9\n";
    const { rows, errors } = parseEmployeeCsv(csv);
    expect(errors).toHaveLength(0);
    // emails are normalized to lowercase
    expect(rows).toEqual([{ fullName: "John Smith", email: "john@example.com", employeeIdExternal: "ext-9" }]);
  });

  it("omits employeeIdExternal when not provided", () => {
    const csv = "full_name,email\nJane Doe,jane@example.com\n";
    const { rows } = parseEmployeeCsv(csv);
    expect(rows[0].employeeIdExternal).toBeUndefined();
  });

  it("collects an error for an invalid email without aborting other rows", () => {
    const csv = "full_name,email\nBad Row,not-an-email\nGood Row,good@example.com\n";
    const { rows, errors } = parseEmployeeCsv(csv);
    expect(rows).toEqual([{ fullName: "Good Row", email: "good@example.com", employeeIdExternal: undefined }]);
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
    expect(rows).toEqual([{ fullName: "First", email: "dup@example.com", employeeIdExternal: undefined }]);
    expect(errors[0].message).toMatch(/Duplicate email/);
  });

  it("leaves needsSpouseForm undefined when the column is absent", () => {
    const csv = "full_name,email\nJane Doe,jane@example.com\n";
    const { rows } = parseEmployeeCsv(csv);
    expect(rows[0].needsSpouseForm).toBeUndefined();
  });

  it("parses needs_spouse_form as true for truthy values", () => {
    const csv = "full_name,email,needs_spouse_form\nJane Doe,jane@example.com,yes\nJohn Smith,john@example.com,TRUE\n";
    const { rows } = parseEmployeeCsv(csv);
    expect(rows[0].needsSpouseForm).toBe(true);
    expect(rows[1].needsSpouseForm).toBe(true);
  });

  it("parses needs_spouse_form as false for empty or falsy values", () => {
    const csv = "full_name,email,needs_spouse_form\nJane Doe,jane@example.com,\nJohn Smith,john@example.com,no\n";
    const { rows } = parseEmployeeCsv(csv);
    expect(rows[0].needsSpouseForm).toBe(false);
    expect(rows[1].needsSpouseForm).toBe(false);
  });
});
