import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";
import { createFakePrisma } from "./fakePrisma.js";
import { createFakeBlobStorage, createFakeEmailSender } from "./fakes.js";

async function seedEmployeeAndRecord(
  prisma: ReturnType<typeof createFakePrisma>,
  overrides: Partial<Record<string, unknown>> = {}
) {
  const employee = await prisma.employee.upsert({
    where: { email: "jane.doe@example.com" },
    create: { email: "jane.doe@example.com", fullName: "Jane Doe", active: true },
    update: {},
  });
  const record = {
    id: "rec-1",
    employeeId: employee.id,
    cycleYear: 2026,
    tokenHash: "unused-hash",
    tokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
    status: "sent",
    sentAt: new Date(),
    receivedAt: null,
    completedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
  prisma._state.physicalRecords.push(record);
  return { employee, record };
}

describe("GET /dashboard (AUTH_MODE=mock)", () => {
  it("redirects unauthenticated requests to /auth/login", async () => {
    const prisma = createFakePrisma();
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());

    const res = await request(app).get("/dashboard");
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/auth\/login/);
  });

  it("shows the dev sign-in page", async () => {
    const prisma = createFakePrisma();
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());

    const res = await request(app).get("/auth/login");
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/dev sign-in/i);
    expect(res.text).toMatch(/AUTH_MODE=mock/);
  });

  it("lets a dev-signed-in session see the seeded record in the status table", async () => {
    const prisma = createFakePrisma();
    await seedEmployeeAndRecord(prisma);
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());
    const agent = request.agent(app);

    await agent.post("/auth/login").type("form").send({ returnTo: "/dashboard?year=2026" });

    const res = await agent.get("/dashboard?year=2026");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Jane Doe");
    expect(res.text).toContain("jane.doe@example.com");
    expect(res.text).toMatch(/status-sent/);
  });

  it("filters by status via the query param", async () => {
    const prisma = createFakePrisma();
    await seedEmployeeAndRecord(prisma, { status: "sent" });
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());
    const agent = request.agent(app);
    await agent.post("/auth/login").type("form").send({ returnTo: "/dashboard" });

    const res = await agent.get("/dashboard?year=2026&status=completed");
    expect(res.status).toBe(200);
    expect(res.text).not.toContain("Jane Doe");
    expect(res.text).toMatch(/no records for this cycle/i);
  });
});

describe("POST /dashboard/records/:id/resend", () => {
  it("generates a fresh token, resets to sent, and redirects back preserving filters", async () => {
    const prisma = createFakePrisma();
    const emailSender = createFakeEmailSender();
    const { record } = await seedEmployeeAndRecord(prisma, {
      status: "needs_review",
      receivedAt: new Date(),
      uploadedFileUrl: "https://fake-blob.test/old-file.pdf",
    });
    const app = createApp(prisma as any, createFakeBlobStorage(), emailSender);
    const agent = request.agent(app);
    await agent.post("/auth/login").type("form").send({ returnTo: "/dashboard" });

    const res = await agent.post(`/dashboard/records/${record.id}/resend?year=2026&status=needs_review`);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe("/dashboard?year=2026&status=needs_review");

    const updated = prisma._state.physicalRecords.find((r: any) => r.id === record.id);
    expect(updated.status).toBe("sent");
    expect(updated.tokenHash).not.toBe("unused-hash");
    expect(updated.receivedAt).toBeNull();
    expect(updated.uploadedFileUrl).toBeNull();
    expect(emailSender.sent).toHaveLength(1);
    expect(emailSender.sent[0].toEmail).toBe("jane.doe@example.com");
  });

  it("resets the record but redirects with resendFailed=1 when the email send throws", async () => {
    const prisma = createFakePrisma();
    const emailSender = createFakeEmailSender({ failFor: new Set(["jane.doe@example.com"]) });
    const { record } = await seedEmployeeAndRecord(prisma);
    const app = createApp(prisma as any, createFakeBlobStorage(), emailSender);
    const agent = request.agent(app);
    await agent.post("/auth/login").type("form").send({ returnTo: "/dashboard" });

    const res = await agent.post(`/dashboard/records/${record.id}/resend?year=2026`);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe("/dashboard?year=2026&resendFailed=1");

    const updated = prisma._state.physicalRecords.find((r: any) => r.id === record.id);
    expect(updated.status).toBe("sent");
    expect(updated.sentAt).toBeNull();

    const page = await agent.get("/dashboard?year=2026&resendFailed=1");
    expect(page.text).toMatch(/email failed to send/i);
  });

  it("hides Resend/Get Link and shows an inactive note for a deactivated employee", async () => {
    const prisma = createFakePrisma();
    await seedEmployeeAndRecord(prisma);
    prisma._state.employeesByEmail.get("jane.doe@example.com").active = false;
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());
    const agent = request.agent(app);
    await agent.post("/auth/login").type("form").send({ returnTo: "/dashboard" });

    const res = await agent.get("/dashboard?year=2026");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Employee inactive");
    expect(res.text).not.toContain("/resend?");
    expect(res.text).not.toContain("Get Link");
  });
});

describe("POST /dashboard/records/:id/link", () => {
  it("generates a fresh token, resets to sent, shows the link, and sends no email", async () => {
    const prisma = createFakePrisma();
    const emailSender = createFakeEmailSender();
    const { record } = await seedEmployeeAndRecord(prisma, {
      status: "needs_review",
      receivedAt: new Date(),
      uploadedFileUrl: "https://fake-blob.test/old-file.pdf",
    });
    const app = createApp(prisma as any, createFakeBlobStorage(), emailSender);
    const agent = request.agent(app);
    await agent.post("/auth/login").type("form").send({ returnTo: "/dashboard" });

    const res = await agent.post(`/dashboard/records/${record.id}/link?year=2026&status=needs_review`);
    expect(res.status).toBe(200);
    expect(res.text).toContain("Jane Doe");
    expect(res.text).toMatch(/\/physical\/[\w-]+/);
    expect(res.text).toContain('href="/dashboard?year=2026&status=needs_review"');

    const updated = prisma._state.physicalRecords.find((r: any) => r.id === record.id);
    expect(updated.status).toBe("sent");
    expect(updated.tokenHash).not.toBe("unused-hash");
    expect(updated.sentAt).toBeNull();
    expect(updated.receivedAt).toBeNull();
    expect(updated.uploadedFileUrl).toBeNull();
    expect(emailSender.sent).toHaveLength(0);
  });

  it("requires auth", async () => {
    const prisma = createFakePrisma();
    const { record } = await seedEmployeeAndRecord(prisma);
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());

    const res = await request(app).post(`/dashboard/records/${record.id}/link`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/auth\/login/);
  });
});
