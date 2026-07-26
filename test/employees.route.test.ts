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
    expect(res.text).toContain("Add an employee");
    expect(res.text).toContain("Upload CSV");
    expect(res.text).toContain("Existing Person");
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
