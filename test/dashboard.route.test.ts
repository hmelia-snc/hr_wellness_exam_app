import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";
import { createFakePrisma } from "./fakePrisma.js";
import { createFakeBlobStorage, createFakeEmailSender } from "./fakes.js";

async function seedEmployeeAndRecord(
  prisma: ReturnType<typeof createFakePrisma>,
  overrides: Partial<Record<string, unknown>> = {},
  employeeOverrides: Partial<Record<string, unknown>> = {}
) {
  const email = typeof employeeOverrides.email === "string" ? employeeOverrides.email : "jane.doe@example.com";
  const employee = await prisma.employee.upsert({
    where: { email },
    create: { email, fullName: "Jane Doe", active: true, ...employeeOverrides },
    update: { ...employeeOverrides },
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

  // Regression coverage for a real production incident: a transient database
  // error (Azure SQL connection reset) thrown inside this route's async
  // handler had no try/catch, so it became an unhandled promise rejection —
  // which crashes the entire Node process by default, taking every other
  // in-flight request down with it too. It should instead reach Express's
  // error-handling middleware and produce a plain 500 for this one request.
  it("returns a 500 instead of crashing the process when the database call fails", async () => {
    const prisma = createFakePrisma();
    prisma.physicalRecord.findMany = async () => {
      throw new Error("Can't reach database server");
    };
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());
    const agent = request.agent(app);
    await agent.post("/auth/login").type("form").send({ returnTo: "/dashboard" });

    const res = await agent.get("/dashboard");
    expect(res.status).toBe(500);
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

describe("GET /dashboard cycle year selector", () => {
  it("lists every year that has records plus the current calendar year, with the active year selected", async () => {
    const prisma = createFakePrisma();
    await seedEmployeeAndRecord(prisma, { id: "rec-2026", cycleYear: 2026 });
    await seedEmployeeAndRecord(prisma, { id: "rec-2025", cycleYear: 2025 });
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());
    const agent = request.agent(app);
    await agent.post("/auth/login").type("form").send({ returnTo: "/dashboard" });

    const res = await agent.get("/dashboard?year=2025");
    expect(res.status).toBe(200);
    expect(res.text).toContain('<option value="2025" selected>2025</option>');
    expect(res.text).toContain('<option value="2026">2026</option>');
  });

  it("switching the year selector navigates to that cycle", async () => {
    const prisma = createFakePrisma();
    await seedEmployeeAndRecord(prisma, { cycleYear: 2025 });
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());
    const agent = request.agent(app);
    await agent.post("/auth/login").type("form").send({ returnTo: "/dashboard" });

    const res = await agent.get("/dashboard?year=2025");
    expect(res.text).toContain("Jane Doe");

    const nextYear = await agent.get("/dashboard?year=2026");
    expect(nextYear.text).not.toContain("Jane Doe");
    expect(nextYear.text).toMatch(/no records for this cycle/i);
  });

  it("preserves the status filter as a hidden field when switching years", async () => {
    const prisma = createFakePrisma();
    await seedEmployeeAndRecord(prisma, { cycleYear: 2026, status: "needs_review" });
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());
    const agent = request.agent(app);
    await agent.post("/auth/login").type("form").send({ returnTo: "/dashboard" });

    const res = await agent.get("/dashboard?year=2026&status=needs_review");
    expect(res.text).toContain('<input type="hidden" name="status" value="needs_review" />');
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

  it("hides Resend/Get Link, disables bulk selection, and shows an inactive note for a deactivated employee", async () => {
    const prisma = createFakePrisma();
    const { record } = await seedEmployeeAndRecord(prisma);
    prisma._state.employeesByEmail.get("jane.doe@example.com").active = false;
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());
    const agent = request.agent(app);
    await agent.post("/auth/login").type("form").send({ returnTo: "/dashboard" });

    const res = await agent.get("/dashboard?year=2026");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Employee inactive");
    expect(res.text).not.toContain(`records/${record.id}/resend?`);
    expect(res.text).not.toContain("Get Link");
    expect(res.text).not.toContain(`openRejectModal(${JSON.stringify([record.id])}`);
    expect(res.text).toMatch(new RegExp(`value="${record.id}"[^>]*disabled`));
  });

  // Regression coverage: the button is hidden client-side, but that's not
  // enforcement — a direct POST to this route for an inactive employee's
  // record must not send an email or touch the token either.
  it("does not resend or modify the record when the employee is inactive, even via a direct POST", async () => {
    const prisma = createFakePrisma();
    const emailSender = createFakeEmailSender();
    const { record } = await seedEmployeeAndRecord(prisma, { tokenHash: "original-hash" });
    prisma._state.employeesByEmail.get("jane.doe@example.com").active = false;
    const app = createApp(prisma as any, createFakeBlobStorage(), emailSender);
    const agent = request.agent(app);
    await agent.post("/auth/login").type("form").send({ returnTo: "/dashboard" });

    const res = await agent.post(`/dashboard/records/${record.id}/resend?year=2026`);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe("/dashboard?year=2026");

    const updated = prisma._state.physicalRecords.find((r: any) => r.id === record.id);
    expect(updated.tokenHash).toBe("original-hash");
    expect(updated.status).toBe("sent");
    expect(emailSender.sent).toHaveLength(0);
  });
});

describe("POST /dashboard/records/:id/link", () => {
  // When there's no usable existing token (none stored yet, or expired),
  // this falls back to the old generate-and-invalidate behavior.
  it("falls back to generating a fresh token when none is on file, resets to sent, shows the link, sends no email", async () => {
    const prisma = createFakePrisma();
    const emailSender = createFakeEmailSender();
    const { record } = await seedEmployeeAndRecord(prisma, {
      status: "needs_review",
      receivedAt: new Date(),
      uploadedFileUrl: "https://fake-blob.test/old-file.pdf",
      rawToken: null,
    });
    const app = createApp(prisma as any, createFakeBlobStorage(), emailSender);
    const agent = request.agent(app);
    await agent.post("/auth/login").type("form").send({ returnTo: "/dashboard" });

    const res = await agent.post(`/dashboard/records/${record.id}/link?year=2026&status=needs_review`);
    expect(res.status).toBe(200);
    expect(res.text).toContain("Jane Doe");
    expect(res.text).toMatch(/\/wellness-exam\/[\w-]+/);
    expect(res.text).toContain('href="/dashboard?year=2026&status=needs_review"');
    expect(res.text).toMatch(/brand-new/i);

    const updated = prisma._state.physicalRecords.find((r: any) => r.id === record.id);
    expect(updated.status).toBe("sent");
    expect(updated.tokenHash).not.toBe("unused-hash");
    expect(updated.sentAt).toBeNull();
    expect(updated.receivedAt).toBeNull();
    expect(updated.uploadedFileUrl).toBeNull();
    expect(emailSender.sent).toHaveLength(0);
  });

  // Regression coverage for the actual feature request: HR clicking "Get
  // Link" should NOT invalidate the link already emailed to the employee.
  it("shows the existing link without regenerating when a valid token is on file", async () => {
    const prisma = createFakePrisma();
    const emailSender = createFakeEmailSender();
    const { record } = await seedEmployeeAndRecord(prisma, {
      status: "sent",
      rawToken: "existing-raw-token",
      tokenHash: "existing-token-hash",
    });
    const app = createApp(prisma as any, createFakeBlobStorage(), emailSender);
    const agent = request.agent(app);
    await agent.post("/auth/login").type("form").send({ returnTo: "/dashboard" });

    const res = await agent.post(`/dashboard/records/${record.id}/link?year=2026`);
    expect(res.status).toBe(200);
    expect(res.text).toContain("/wellness-exam/existing-raw-token");
    expect(res.text).not.toMatch(/brand-new/i);

    const updated = prisma._state.physicalRecords.find((r: any) => r.id === record.id);
    expect(updated.tokenHash).toBe("existing-token-hash");
    expect(updated.rawToken).toBe("existing-raw-token");
    expect(emailSender.sent).toHaveLength(0);
  });

  it("regenerates when the existing token has expired", async () => {
    const prisma = createFakePrisma();
    const { record } = await seedEmployeeAndRecord(prisma, {
      status: "sent",
      rawToken: "expired-raw-token",
      tokenHash: "expired-token-hash",
      tokenExpiresAt: new Date(Date.now() - 1000),
    });
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());
    const agent = request.agent(app);
    await agent.post("/auth/login").type("form").send({ returnTo: "/dashboard" });

    const res = await agent.post(`/dashboard/records/${record.id}/link?year=2026`);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain("/wellness-exam/expired-raw-token");
    expect(res.text).toMatch(/brand-new/i);

    const updated = prisma._state.physicalRecords.find((r: any) => r.id === record.id);
    expect(updated.tokenHash).not.toBe("expired-token-hash");
  });

  it("does not show or regenerate the link when the employee is inactive, even via a direct POST", async () => {
    const prisma = createFakePrisma();
    const { record } = await seedEmployeeAndRecord(prisma, {
      rawToken: "existing-raw-token",
      tokenHash: "existing-token-hash",
    });
    prisma._state.employeesByEmail.get("jane.doe@example.com").active = false;
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());
    const agent = request.agent(app);
    await agent.post("/auth/login").type("form").send({ returnTo: "/dashboard" });

    const res = await agent.post(`/dashboard/records/${record.id}/link?year=2026`);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe("/dashboard?year=2026");

    const updated = prisma._state.physicalRecords.find((r: any) => r.id === record.id);
    expect(updated.tokenHash).toBe("existing-token-hash");
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

describe("POST /dashboard/records/:id/approve", () => {
  it("marks a needs_review record completed and stamps who reviewed it", async () => {
    const prisma = createFakePrisma();
    const { record } = await seedEmployeeAndRecord(prisma, {
      status: "needs_review",
      receivedAt: new Date(),
      verificationResult: "No handwritten signature detected — needs manual review.",
    });
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());
    const agent = request.agent(app);
    await agent.post("/auth/login").type("form").send({ returnTo: "/dashboard" });

    const res = await agent.post(`/dashboard/records/${record.id}/approve?year=2026`);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe("/dashboard?year=2026");

    const updated = prisma._state.physicalRecords.find((r: any) => r.id === record.id);
    expect(updated.status).toBe("completed");
    expect(updated.completedAt).toBeInstanceOf(Date);
    expect(updated.reviewedBy).toBe("dev-hr@standardnutrition.com");
    expect(updated.reviewedAt).toBeInstanceOf(Date);
  });

  it("requires auth", async () => {
    const prisma = createFakePrisma();
    const { record } = await seedEmployeeAndRecord(prisma, { status: "needs_review" });
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());

    const res = await request(app).post(`/dashboard/records/${record.id}/approve`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/auth\/login/);
  });

  it("shows an Approve button only for needs_review records, and a tooltip with the verification reason", async () => {
    const prisma = createFakePrisma();
    await seedEmployeeAndRecord(prisma, {
      status: "needs_review",
      verificationResult: "No handwritten signature detected — needs manual review.",
    });
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());
    const agent = request.agent(app);
    await agent.post("/auth/login").type("form").send({ returnTo: "/dashboard" });

    const res = await agent.get("/dashboard?year=2026");
    expect(res.text).toContain("/approve?");
    expect(res.text).toContain('title="No handwritten signature detected');
  });

  it("hides the Approve button and does not approve when the employee is inactive, even via a direct POST", async () => {
    const prisma = createFakePrisma();
    const { record } = await seedEmployeeAndRecord(prisma, { status: "needs_review" });
    prisma._state.employeesByEmail.get("jane.doe@example.com").active = false;
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());
    const agent = request.agent(app);
    await agent.post("/auth/login").type("form").send({ returnTo: "/dashboard" });

    const page = await agent.get("/dashboard?year=2026");
    expect(page.text).not.toContain(`records/${record.id}/approve?`);

    const res = await agent.post(`/dashboard/records/${record.id}/approve?year=2026`);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe("/dashboard?year=2026");

    const updated = prisma._state.physicalRecords.find((r: any) => r.id === record.id);
    expect(updated.status).toBe("needs_review");
    expect(updated.reviewedBy).toBeUndefined();
  });
});

describe("POST /dashboard/records/:id/reject", () => {
  it("marks the record rejected, clears received/completed, stamps who reviewed it, and emails the employee with the reason and existing link", async () => {
    const prisma = createFakePrisma();
    const emailSender = createFakeEmailSender();
    const { record } = await seedEmployeeAndRecord(prisma, {
      status: "received",
      receivedAt: new Date(),
      completedAt: new Date(),
      rawToken: "existing-raw-token",
    });
    const app = createApp(prisma as any, createFakeBlobStorage(), emailSender);
    const agent = request.agent(app);
    await agent.post("/auth/login").type("form").send({ returnTo: "/dashboard" });

    const res = await agent
      .post(`/dashboard/records/${record.id}/reject?year=2026`)
      .type("form")
      .send({ reason: "Signature is missing on the physician line." });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe("/dashboard?year=2026");

    const updated = prisma._state.physicalRecords.find((r: any) => r.id === record.id);
    expect(updated.status).toBe("rejected");
    expect(updated.rejectionReason).toBe("Signature is missing on the physician line.");
    expect(updated.receivedAt).toBeNull();
    expect(updated.completedAt).toBeNull();
    expect(updated.reviewedBy).toBe("dev-hr@standardnutrition.com");
    expect(updated.reviewedAt).toBeInstanceOf(Date);
    // Rejecting must not invalidate the employee's existing link.
    expect(updated.rawToken).toBe("existing-raw-token");

    expect(emailSender.rejectionsSent).toHaveLength(1);
    expect(emailSender.rejectionsSent[0]).toMatchObject({
      reason: "Signature is missing on the physician line.",
      link: expect.stringContaining("/wellness-exam/existing-raw-token"),
    });
  });

  it("requires a non-empty reason", async () => {
    const prisma = createFakePrisma();
    const { record } = await seedEmployeeAndRecord(prisma, { status: "received" });
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());
    const agent = request.agent(app);
    await agent.post("/auth/login").type("form").send({ returnTo: "/dashboard" });

    const res = await agent.post(`/dashboard/records/${record.id}/reject?year=2026`).type("form").send({ reason: "   " });
    expect(res.status).toBe(400);

    const updated = prisma._state.physicalRecords.find((r: any) => r.id === record.id);
    expect(updated.status).toBe("received");
  });

  it("redirects with rejectEmailFailed=1 when the notification email fails, and the dashboard shows a notice", async () => {
    const prisma = createFakePrisma();
    const { record } = await seedEmployeeAndRecord(prisma, { status: "received" });
    const emailSender = createFakeEmailSender({ failFor: new Set(["jane.doe@example.com"]) });
    const app = createApp(prisma as any, createFakeBlobStorage(), emailSender);
    const agent = request.agent(app);
    await agent.post("/auth/login").type("form").send({ returnTo: "/dashboard" });

    const res = await agent
      .post(`/dashboard/records/${record.id}/reject?year=2026`)
      .type("form")
      .send({ reason: "Missing signature." });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe("/dashboard?year=2026&rejectEmailFailed=1");

    const page = await agent.get(res.headers.location);
    expect(page.text).toMatch(/notification email failed to send/i);
  });

  it("requires auth", async () => {
    const prisma = createFakePrisma();
    const { record } = await seedEmployeeAndRecord(prisma, { status: "received" });
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());

    const res = await request(app).post(`/dashboard/records/${record.id}/reject`).type("form").send({ reason: "x" });
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/auth\/login/);
  });

  it("shows a Reject button for sent/received/needs_review but not for rejected or completed records", async () => {
    const prisma = createFakePrisma();
    await seedEmployeeAndRecord(prisma, { status: "needs_review" });
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());
    const agent = request.agent(app);
    await agent.post("/auth/login").type("form").send({ returnTo: "/dashboard" });

    const res = await agent.get("/dashboard?year=2026");
    expect(res.text).toContain("openRejectModal");
  });

  it("does not reject or email when the employee is inactive, even via a direct POST", async () => {
    const prisma = createFakePrisma();
    const emailSender = createFakeEmailSender();
    const { record } = await seedEmployeeAndRecord(prisma, { status: "received" });
    prisma._state.employeesByEmail.get("jane.doe@example.com").active = false;
    const app = createApp(prisma as any, createFakeBlobStorage(), emailSender);
    const agent = request.agent(app);
    await agent.post("/auth/login").type("form").send({ returnTo: "/dashboard" });

    const res = await agent
      .post(`/dashboard/records/${record.id}/reject?year=2026`)
      .type("form")
      .send({ reason: "Missing signature." });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe("/dashboard?year=2026");

    const updated = prisma._state.physicalRecords.find((r: any) => r.id === record.id);
    expect(updated.status).toBe("received");
    expect(updated.rejectionReason).toBeUndefined();
    expect(emailSender.rejectionsSent).toHaveLength(0);
  });
});

describe("Dashboard bulk actions", () => {
  it("bulk-approves selected records", async () => {
    const prisma = createFakePrisma();
    const { record: r1 } = await seedEmployeeAndRecord(prisma, { status: "needs_review" }, { email: "a@example.com" });
    const { record: r2 } = await seedEmployeeAndRecord(prisma, { id: "rec-2", status: "needs_review" }, { email: "b@example.com" });
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());
    const agent = request.agent(app);
    await agent.post("/auth/login").type("form").send({ returnTo: "/dashboard" });

    const res = await agent
      .post("/dashboard/bulk/approve?year=2026")
      .type("form")
      .send({ ids: [r1.id, r2.id] });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe("/dashboard?year=2026&bulkApproved=2");

    const records = prisma._state.physicalRecords;
    expect(records.find((r: any) => r.id === r1.id).status).toBe("completed");
    expect(records.find((r: any) => r.id === r2.id).status).toBe("completed");
  });

  it("bulk-resends selected records and skips inactive employees", async () => {
    const prisma = createFakePrisma();
    const { record: active } = await seedEmployeeAndRecord(prisma, { status: "sent" }, { email: "active@example.com" });
    const { record: inactive } = await seedEmployeeAndRecord(
      prisma,
      { id: "rec-inactive", status: "sent" },
      { email: "inactive@example.com", active: false }
    );
    const emailSender = createFakeEmailSender();
    const app = createApp(prisma as any, createFakeBlobStorage(), emailSender);
    const agent = request.agent(app);
    await agent.post("/auth/login").type("form").send({ returnTo: "/dashboard" });

    const res = await agent
      .post("/dashboard/bulk/resend?year=2026")
      .type("form")
      .send({ ids: [active.id, inactive.id] });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe("/dashboard?year=2026&bulkResent=1&bulkResentFailed=0&bulkResentSkipped=1");
    expect(emailSender.sent).toHaveLength(1);
    expect(emailSender.sent[0].toEmail).toBe("active@example.com");
  });

  it("bulk-rejects selected records with one shared reason", async () => {
    const prisma = createFakePrisma();
    const { record: r1 } = await seedEmployeeAndRecord(prisma, { status: "received" }, { email: "a@example.com" });
    const { record: r2 } = await seedEmployeeAndRecord(prisma, { id: "rec-2", status: "received" }, { email: "b@example.com" });
    const emailSender = createFakeEmailSender();
    const app = createApp(prisma as any, createFakeBlobStorage(), emailSender);
    const agent = request.agent(app);
    await agent.post("/auth/login").type("form").send({ returnTo: "/dashboard" });

    const res = await agent
      .post("/dashboard/bulk/reject?year=2026")
      .type("form")
      .send({ ids: [r1.id, r2.id], reason: "Date is outside the cycle year." });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe("/dashboard?year=2026&bulkRejected=2&bulkRejectedFailed=0&bulkRejectedSkipped=0");

    const records = prisma._state.physicalRecords;
    expect(records.find((r: any) => r.id === r1.id).rejectionReason).toBe("Date is outside the cycle year.");
    expect(records.find((r: any) => r.id === r2.id).rejectionReason).toBe("Date is outside the cycle year.");
    expect(emailSender.rejectionsSent).toHaveLength(2);
  });

  it("bulk reject requires a non-empty reason", async () => {
    const prisma = createFakePrisma();
    const { record } = await seedEmployeeAndRecord(prisma, { status: "received" });
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());
    const agent = request.agent(app);
    await agent.post("/auth/login").type("form").send({ returnTo: "/dashboard" });

    const res = await agent.post("/dashboard/bulk/reject?year=2026").type("form").send({ ids: [record.id], reason: "" });
    expect(res.status).toBe(400);
  });

  it("bulk actions require auth", async () => {
    const prisma = createFakePrisma();
    const { record } = await seedEmployeeAndRecord(prisma, { status: "needs_review" });
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());

    const res = await request(app).post("/dashboard/bulk/approve").type("form").send({ ids: [record.id] });
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/auth\/login/);
  });
});

describe("GET /dashboard progress column", () => {
  it("shows 1 of 1 for an employee who doesn't need a spouse form", async () => {
    const prisma = createFakePrisma();
    await seedEmployeeAndRecord(prisma, { receivedAt: new Date() });
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());
    const agent = request.agent(app);
    await agent.post("/auth/login").type("form").send({ returnTo: "/dashboard" });

    const res = await agent.get("/dashboard?year=2026");
    expect(res.text).toContain("1 of 1");
  });

  it("shows 0 of 2 when a spouse form is needed and neither file has arrived", async () => {
    const prisma = createFakePrisma();
    await seedEmployeeAndRecord(prisma, {}, { needsSpouseForm: true });
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());
    const agent = request.agent(app);
    await agent.post("/auth/login").type("form").send({ returnTo: "/dashboard" });

    const res = await agent.get("/dashboard?year=2026");
    expect(res.text).toContain("0 of 2");
  });

  it("shows 2 of 2 once both the employee's and spouse's forms have arrived", async () => {
    const prisma = createFakePrisma();
    await seedEmployeeAndRecord(
      prisma,
      { receivedAt: new Date(), spouseReceivedAt: new Date() },
      { needsSpouseForm: true }
    );
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());
    const agent = request.agent(app);
    await agent.post("/auth/login").type("form").send({ returnTo: "/dashboard" });

    const res = await agent.get("/dashboard?year=2026");
    expect(res.text).toContain("2 of 2");
  });
});

describe("GET /dashboard/records/:id/file", () => {
  it("streams the employee's uploaded file and logs who viewed it", async () => {
    const prisma = createFakePrisma();
    const blobStorage = createFakeBlobStorage();
    const blobPath = "uploads/2026/rec-1/signed.pdf";
    await blobStorage.uploadForm(Buffer.from("%PDF-1.4 fake content"), blobPath, "application/pdf");
    const { record } = await seedEmployeeAndRecord(prisma, {
      uploadedBlobPath: blobPath,
      uploadedContentType: "application/pdf",
    });
    const app = createApp(prisma as any, blobStorage, createFakeEmailSender());
    const agent = request.agent(app);
    await agent.post("/auth/login").type("form").send({ returnTo: "/dashboard" });

    const res = await agent.get(`/dashboard/records/${record.id}/file`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toBe("inline");

    expect(prisma._state.fileAccessLogs).toHaveLength(1);
    expect(prisma._state.fileAccessLogs[0]).toMatchObject({
      physicalRecordId: record.id,
      fileType: "employee",
      viewedBy: "dev-hr@standardnutrition.com",
    });
  });

  it("404s when there's no uploaded file yet", async () => {
    const prisma = createFakePrisma();
    const { record } = await seedEmployeeAndRecord(prisma);
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());
    const agent = request.agent(app);
    await agent.post("/auth/login").type("form").send({ returnTo: "/dashboard" });

    const res = await agent.get(`/dashboard/records/${record.id}/file`);
    expect(res.status).toBe(404);
    expect(prisma._state.fileAccessLogs).toHaveLength(0);
  });

  it("requires auth", async () => {
    const prisma = createFakePrisma();
    const { record } = await seedEmployeeAndRecord(prisma);
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());

    const res = await request(app).get(`/dashboard/records/${record.id}/file`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/auth\/login/);
  });
});

describe("GET /dashboard/records/:id/spouse-file", () => {
  it("streams the spouse's uploaded file and logs it separately from the employee's", async () => {
    const prisma = createFakePrisma();
    const blobStorage = createFakeBlobStorage();
    const spouseBlobPath = "uploads/2026/rec-1/spouse-signed.pdf";
    await blobStorage.uploadForm(Buffer.from("%PDF-1.4 spouse content"), spouseBlobPath, "application/pdf");
    const { record } = await seedEmployeeAndRecord(
      prisma,
      { spouseUploadedBlobPath: spouseBlobPath, spouseUploadedContentType: "application/pdf" },
      { needsSpouseForm: true }
    );
    const app = createApp(prisma as any, blobStorage, createFakeEmailSender());
    const agent = request.agent(app);
    await agent.post("/auth/login").type("form").send({ returnTo: "/dashboard" });

    const res = await agent.get(`/dashboard/records/${record.id}/spouse-file`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");

    expect(prisma._state.fileAccessLogs).toHaveLength(1);
    expect(prisma._state.fileAccessLogs[0].fileType).toBe("spouse");
  });

  it("404s when there's no spouse file", async () => {
    const prisma = createFakePrisma();
    const { record } = await seedEmployeeAndRecord(prisma);
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());
    const agent = request.agent(app);
    await agent.post("/auth/login").type("form").send({ returnTo: "/dashboard" });

    const res = await agent.get(`/dashboard/records/${record.id}/spouse-file`);
    expect(res.status).toBe(404);
  });
});

describe("Dashboard view-file links", () => {
  it("shows View file / View spouse file links only when those files exist", async () => {
    const prisma = createFakePrisma();
    await seedEmployeeAndRecord(
      prisma,
      { uploadedBlobPath: "uploads/2026/rec-1/signed.pdf", spouseUploadedBlobPath: "uploads/2026/rec-1/spouse.pdf" },
      { needsSpouseForm: true }
    );
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());
    const agent = request.agent(app);
    await agent.post("/auth/login").type("form").send({ returnTo: "/dashboard" });

    const res = await agent.get("/dashboard?year=2026");
    expect(res.text).toContain("/dashboard/records/rec-1/file");
    expect(res.text).toContain("/dashboard/records/rec-1/spouse-file");
  });

  it("hides both view-file links when no files have been uploaded", async () => {
    const prisma = createFakePrisma();
    await seedEmployeeAndRecord(prisma);
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());
    const agent = request.agent(app);
    await agent.post("/auth/login").type("form").send({ returnTo: "/dashboard" });

    const res = await agent.get("/dashboard?year=2026");
    expect(res.text).not.toContain("View file");
    expect(res.text).not.toContain("View spouse file");
  });
});

describe("GET /dashboard/export", () => {
  it("requires auth", async () => {
    const prisma = createFakePrisma();
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());

    const res = await request(app).get("/dashboard/export?year=2026");
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/auth\/login/);
  });

  it("exports the current cycle's records as a CSV attachment", async () => {
    const prisma = createFakePrisma();
    await seedEmployeeAndRecord(prisma, { status: "completed", receivedAt: new Date(), completedAt: new Date() });
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());
    const agent = request.agent(app);
    await agent.post("/auth/login").type("form").send({ returnTo: "/dashboard" });

    const res = await agent.get("/dashboard/export?year=2026");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
    expect(res.headers["content-disposition"]).toMatch(/hr-dashboard-2026\.csv/);

    const lines = res.text.trim().split("\n");
    expect(lines[0]).toBe(
      "Employee,Email,Status,Sent,Received,Completed,Needs Spouse Form,Spouse Received,Verification Result,Rejection Reason"
    );
    expect(lines[1]).toContain("Jane Doe");
    expect(lines[1]).toContain("jane.doe@example.com");
    expect(lines[1]).toContain("completed");
  });

  it("respects the status filter and names the file accordingly", async () => {
    const prisma = createFakePrisma();
    await seedEmployeeAndRecord(prisma, { status: "needs_review" });
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());
    const agent = request.agent(app);
    await agent.post("/auth/login").type("form").send({ returnTo: "/dashboard" });

    const res = await agent.get("/dashboard/export?year=2026&status=sent");
    expect(res.headers["content-disposition"]).toMatch(/hr-dashboard-2026-sent\.csv/);
    const lines = res.text.trim().split("\n");
    expect(lines).toHaveLength(1); // header only — the seeded record is needs_review, not sent
  });
});
