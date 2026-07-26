import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";
import { createFakePrisma } from "./fakePrisma.js";
import type { BlobStorage } from "../src/lib/blobStorage.js";

function fakeBlobStorage(): BlobStorage {
  return {
    async uploadForm() {
      return "https://fake-blob.test/unused";
    },
    async downloadForm() {
      return Buffer.from("unused");
    },
  };
}

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
    const app = createApp(prisma as any, fakeBlobStorage());

    const res = await request(app).get("/dashboard");
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/auth\/login/);
  });

  it("shows the dev sign-in page", async () => {
    const prisma = createFakePrisma();
    const app = createApp(prisma as any, fakeBlobStorage());

    const res = await request(app).get("/auth/login");
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/dev sign-in/i);
    expect(res.text).toMatch(/AUTH_MODE=mock/);
  });

  it("lets a dev-signed-in session see the seeded record in the status table", async () => {
    const prisma = createFakePrisma();
    await seedEmployeeAndRecord(prisma);
    const app = createApp(prisma as any, fakeBlobStorage());
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
    const app = createApp(prisma as any, fakeBlobStorage());
    const agent = request.agent(app);
    await agent.post("/auth/login").type("form").send({ returnTo: "/dashboard" });

    const res = await agent.get("/dashboard?year=2026&status=completed");
    expect(res.status).toBe(200);
    expect(res.text).not.toContain("Jane Doe");
    expect(res.text).toMatch(/no records for this cycle/i);
  });
});
