import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";
import { createFakePrisma } from "./fakePrisma.js";
import { createFakeBlobStorage, createFakeEmailSender } from "./fakes.js";

async function signedInAgent(app: ReturnType<typeof createApp>) {
  const agent = request.agent(app);
  await agent.post("/auth/login").type("form").send({ returnTo: "/dashboard/employees" });
  return agent;
}

describe("GET /dashboard/employees", () => {
  it("redirects unauthenticated requests to /auth/login", async () => {
    const prisma = createFakePrisma();
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());

    const res = await request(app).get("/dashboard/employees");
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/auth\/login/);
  });

  it("shows the add-employee and CSV upload forms plus the roster", async () => {
    const prisma = createFakePrisma();
    await prisma.employee.upsert({
      where: { email: "existing@example.com" },
      create: { email: "existing@example.com", fullName: "Existing Person", active: true },
      update: {},
    });
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());
    const agent = await signedInAgent(app);

    const res = await agent.get("/dashboard/employees");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Add a record");
    expect(res.text).toContain("Upload CSV");
    expect(res.text).toContain("Existing Person");
  });

  // Regression coverage: this handler had no try/catch around its database
  // call, so a real failure (e.g. a transient Azure SQL connection reset)
  // would become an unhandled promise rejection and crash the whole process
  // instead of just failing this one request with a 500.
  it("returns a 500 instead of crashing the process when the database call fails", async () => {
    const prisma = createFakePrisma();
    prisma.employee.findMany = async () => {
      throw new Error("Can't reach database server");
    };
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());
    const agent = await signedInAgent(app);

    const res = await agent.get("/dashboard/employees");
    expect(res.status).toBe(500);
  });
});

describe("GET /dashboard/employees/csv-template", () => {
  it("requires auth", async () => {
    const prisma = createFakePrisma();
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());

    const res = await request(app).get("/dashboard/employees/csv-template");
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/auth\/login/);
  });

  it("downloads a CSV with the expected headers and a sample row", async () => {
    const prisma = createFakePrisma();
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());
    const agent = await signedInAgent(app);

    const res = await agent.get("/dashboard/employees/csv-template");
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
    expect(res.headers["content-disposition"]).toMatch(/employee-roster-template\.csv/);
    expect(res.text.split("\n")[0]).toBe("record_type,full_name,email,employee_id_external,linked_employee_email");
  });
});

describe("POST /dashboard/employees (add one)", () => {
  it("creates the employee, sends the email, and redirects with added=added", async () => {
    const prisma = createFakePrisma();
    const emailSender = createFakeEmailSender();
    const app = createApp(prisma as any, createFakeBlobStorage(), emailSender);
    const agent = await signedInAgent(app);

    const res = await agent
      .post("/dashboard/employees")
      .type("form")
      .send({ fullName: "New Person", email: "new.person@example.com", cycleYear: "2026" });

    expect(res.status).toBe(303);
    expect(res.headers.location).toBe("/dashboard/employees?added=added");
    expect(emailSender.sent).toHaveLength(1);
    expect(emailSender.sent[0].toEmail).toBe("new.person@example.com");
    expect(prisma._state.physicalRecords).toHaveLength(1);
  });

  it("redirects with added=exists and sends no email when a record already exists for that cycle", async () => {
    const prisma = createFakePrisma();
    const emailSender = createFakeEmailSender();
    const app = createApp(prisma as any, createFakeBlobStorage(), emailSender);
    const agent = await signedInAgent(app);

    await agent
      .post("/dashboard/employees")
      .type("form")
      .send({ fullName: "New Person", email: "new.person@example.com", cycleYear: "2026" });

    const res = await agent
      .post("/dashboard/employees")
      .type("form")
      .send({ fullName: "New Person", email: "new.person@example.com", cycleYear: "2026" });

    expect(res.status).toBe(303);
    expect(res.headers.location).toBe("/dashboard/employees?added=exists");
    expect(emailSender.sent).toHaveLength(1);
    expect(prisma._state.physicalRecords).toHaveLength(1);
  });

  it("redirects with added=added_email_failed and surfaces the failure when the email send throws", async () => {
    const prisma = createFakePrisma();
    const emailSender = createFakeEmailSender({ failFor: new Set(["fails@example.com"]) });
    const app = createApp(prisma as any, createFakeBlobStorage(), emailSender);
    const agent = await signedInAgent(app);

    const res = await agent
      .post("/dashboard/employees")
      .type("form")
      .send({ fullName: "Fails Person", email: "fails@example.com", cycleYear: "2026" });

    expect(res.status).toBe(303);
    expect(res.headers.location).toBe("/dashboard/employees?added=added_email_failed");
    expect(prisma._state.physicalRecords).toHaveLength(1);

    const page = await agent.get("/dashboard/employees?added=added_email_failed");
    expect(page.text).toMatch(/email failed to send/i);
  });

  it("adds a spouse record linked to an existing employee, with no email required", async () => {
    const prisma = createFakePrisma();
    const emailSender = createFakeEmailSender();
    const app = createApp(prisma as any, createFakeBlobStorage(), emailSender);
    const agent = await signedInAgent(app);

    const employee = await prisma.employee.upsert({
      where: { email: "primary@example.com" },
      create: { email: "primary@example.com", fullName: "Primary Person", active: true },
      update: {},
    });

    const res = await agent
      .post("/dashboard/employees")
      .type("form")
      .send({ recordType: "spouse", fullName: "Spouse Person", linkedEmployeeId: employee.id, cycleYear: "2026" });

    expect(res.status).toBe(303);
    expect(res.headers.location).toBe("/dashboard/employees?added=added");

    const spouse = prisma._state.employees.find((e: any) => e.recordType === "spouse");
    expect(spouse).toBeTruthy();
    expect(spouse.linkedEmployeeId).toBe(employee.id);
    expect(spouse.email).toBeFalsy();
    // No email/link ever goes out for a spouse row.
    expect(emailSender.sent).toHaveLength(0);

    const page = await agent.get("/dashboard/employees");
    expect(page.text).toContain("Spouse Person");
    expect(page.text).toContain("Spouse of Primary Person");
  });

  it("rejects adding a spouse without selecting which employee it belongs to", async () => {
    const prisma = createFakePrisma();
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());
    const agent = await signedInAgent(app);

    const res = await agent
      .post("/dashboard/employees")
      .type("form")
      .send({ recordType: "spouse", fullName: "Spouse Person", cycleYear: "2026" });

    expect(res.status).toBe(400);
  });
});

describe("POST /dashboard/employees/import (CSV)", () => {
  it("imports the CSV, sends emails, and shows a result summary", async () => {
    const prisma = createFakePrisma();
    const emailSender = createFakeEmailSender();
    const app = createApp(prisma as any, createFakeBlobStorage(), emailSender);
    const agent = await signedInAgent(app);

    const csv = "full_name,email\nJane Doe,jane.doe@example.com\nJohn Smith,john.smith@example.com\n";
    const res = await agent
      .post("/dashboard/employees/import")
      .field("cycleYear", "2026")
      .attach("csv", Buffer.from(csv), { filename: "employees.csv", contentType: "text/csv" });

    expect(res.status).toBe(200);
    expect(res.text).toMatch(/2 created and emailed/);
    expect(emailSender.sent).toHaveLength(2);
    expect(prisma._state.physicalRecords).toHaveLength(2);
  });

  it("links a spouse row to its employee via linked_employee_email", async () => {
    const prisma = createFakePrisma();
    const emailSender = createFakeEmailSender();
    const app = createApp(prisma as any, createFakeBlobStorage(), emailSender);
    const agent = await signedInAgent(app);

    const csv =
      "record_type,full_name,email,linked_employee_email\n" +
      "employee,Jane Doe,jane.doe@example.com,\n" +
      "spouse,John Doe,,jane.doe@example.com\n";
    const res = await agent
      .post("/dashboard/employees/import")
      .field("cycleYear", "2026")
      .attach("csv", Buffer.from(csv), { filename: "employees.csv", contentType: "text/csv" });

    expect(res.status).toBe(200);
    expect(res.text).toMatch(/1 spouse\(s\) linked/);

    const jane = prisma._state.employeesByEmail.get("jane.doe@example.com");
    const spouse = prisma._state.employees.find((e: any) => e.recordType === "spouse");
    expect(spouse.fullName).toBe("John Doe");
    expect(spouse.linkedEmployeeId).toBe(jane.id);
    expect(prisma._state.physicalRecords.filter((r: any) => r.employeeId === spouse.id)).toHaveLength(1);
    // Only the employee gets emailed a link — the spouse has none of its own.
    expect(emailSender.sent).toHaveLength(1);
    expect(emailSender.sent[0].toEmail).toBe("jane.doe@example.com");
  });

  it("reports a spouse row whose linked_employee_email doesn't match any employee", async () => {
    const prisma = createFakePrisma();
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());
    const agent = await signedInAgent(app);

    const csv = "record_type,full_name,linked_employee_email\nspouse,John Doe,nobody@example.com\n";
    const res = await agent
      .post("/dashboard/employees/import")
      .field("cycleYear", "2026")
      .attach("csv", Buffer.from(csv), { filename: "employees.csv", contentType: "text/csv" });

    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Spouse rows not linked/);
    expect(res.text).toMatch(/no employee found with email/);
  });
});

describe("POST /dashboard/employees/:id/deactivate and /reactivate", () => {
  it("toggles Employee.active", async () => {
    const prisma = createFakePrisma();
    const employee = await prisma.employee.upsert({
      where: { email: "toggle@example.com" },
      create: { email: "toggle@example.com", fullName: "Toggle Person", active: true },
      update: {},
    });
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());
    const agent = await signedInAgent(app);

    const deactivateRes = await agent.post(`/dashboard/employees/${employee.id}/deactivate`);
    expect(deactivateRes.status).toBe(303);
    expect((await prisma.employee.findUnique({ where: { id: employee.id } }))!.active).toBe(false);

    const reactivateRes = await agent.post(`/dashboard/employees/${employee.id}/reactivate`);
    expect(reactivateRes.status).toBe(303);
    expect((await prisma.employee.findUnique({ where: { id: employee.id } }))!.active).toBe(true);
  });
});

describe("POST /dashboard/employees/:id/delete", () => {
  it("removes the employee and all their physical records, and best-effort deletes blobs", async () => {
    const prisma = createFakePrisma();
    const employee = await prisma.employee.upsert({
      where: { email: "delete-me@example.com" },
      create: { email: "delete-me@example.com", fullName: "Delete Me", active: true },
      update: {},
    });
    prisma._state.physicalRecords.push({
      id: "rec-delete-1",
      employeeId: employee.id,
      cycleYear: 2025,
      tokenHash: "hash-1",
      tokenExpiresAt: new Date(),
      status: "completed",
      uploadedBlobPath: "blob/path-1.pdf",
      createdAt: new Date(),
    });
    prisma._state.physicalRecords.push({
      id: "rec-delete-2",
      employeeId: employee.id,
      cycleYear: 2026,
      tokenHash: "hash-2",
      tokenExpiresAt: new Date(),
      status: "sent",
      createdAt: new Date(),
    });
    const blobStorage = createFakeBlobStorage();
    const app = createApp(prisma as any, blobStorage, createFakeEmailSender());
    const agent = await signedInAgent(app);

    const res = await agent.post(`/dashboard/employees/${employee.id}/delete`);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe("/dashboard/employees?deleted=1");

    expect(await prisma.employee.findUnique({ where: { id: employee.id } })).toBeNull();
    expect(prisma._state.physicalRecords.filter((r: any) => r.employeeId === employee.id)).toHaveLength(0);
    expect(blobStorage.deleted).toEqual(expect.arrayContaining(["blob/path-1.pdf"]));

    const page = await agent.get("/dashboard/employees?deleted=1");
    expect(page.text).toContain("Employee deleted.");
  });

  it("also purges a linked spouse row when deleting the primary employee", async () => {
    const prisma = createFakePrisma();
    const employee = await prisma.employee.upsert({
      where: { email: "primary2@example.com" },
      create: { email: "primary2@example.com", fullName: "Primary Two", active: true },
      update: {},
    });
    const spouse = await prisma.employee.create({
      data: { fullName: "Linked Spouse", recordType: "spouse", linkedEmployeeId: employee.id, active: true },
    });
    prisma._state.physicalRecords.push({
      id: "spouse-rec-1",
      employeeId: spouse.id,
      cycleYear: 2026,
      tokenHash: "hash-spouse",
      tokenExpiresAt: new Date(),
      status: "sent",
      createdAt: new Date(),
    });
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());
    const agent = await signedInAgent(app);

    const res = await agent.post(`/dashboard/employees/${employee.id}/delete`);
    expect(res.status).toBe(303);

    expect(await prisma.employee.findUnique({ where: { id: employee.id } })).toBeNull();
    expect(await prisma.employee.findUnique({ where: { id: spouse.id } })).toBeNull();
    expect(prisma._state.physicalRecords.filter((r: any) => r.employeeId === spouse.id)).toHaveLength(0);
  });
});

describe("POST /dashboard/employees/bulk-delete", () => {
  it("removes multiple employees and their records", async () => {
    const prisma = createFakePrisma();
    const e1 = await prisma.employee.upsert({
      where: { email: "one@example.com" },
      create: { email: "one@example.com", fullName: "One", active: true },
      update: {},
    });
    const e2 = await prisma.employee.upsert({
      where: { email: "two@example.com" },
      create: { email: "two@example.com", fullName: "Two", active: true },
      update: {},
    });
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());
    const agent = await signedInAgent(app);

    const res = await agent.post("/dashboard/employees/bulk-delete").type("form").send({ ids: [e1.id, e2.id] });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe("/dashboard/employees?bulkDeleted=2");

    expect(await prisma.employee.findUnique({ where: { id: e1.id } })).toBeNull();
    expect(await prisma.employee.findUnique({ where: { id: e2.id } })).toBeNull();

    const page = await agent.get(res.headers.location);
    expect(page.text).toContain("Deleted 2 employee(s).");
  });

  it("requires auth", async () => {
    const prisma = createFakePrisma();
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());

    const res = await request(app).post("/dashboard/employees/bulk-delete").type("form").send({ ids: ["some-id"] });
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/auth\/login/);
  });
});
