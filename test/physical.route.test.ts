import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";
import { generateToken } from "../src/lib/token.js";
import { createFakePrisma } from "./fakePrisma.js";
import { createFakeBlobStorage, createFakeEmailSender } from "./fakes.js";

function daysFromNow(days: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function seedRecord(prisma: ReturnType<typeof createFakePrisma>, overrides: Partial<Record<string, unknown>> = {}) {
  const { rawToken, tokenHash } = generateToken();
  const record = {
    id: "rec-1",
    employeeId: "emp-1",
    cycleYear: 2026,
    tokenHash,
    tokenExpiresAt: daysFromNow(10),
    status: "sent",
    ...overrides,
  };
  prisma._state.physicalRecords.push(record);
  return { rawToken, record };
}

describe("GET /physical/:token", () => {
  it("404s with a generic message for an unknown token", async () => {
    const prisma = createFakePrisma();
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());

    const res = await request(app).get("/physical/not-a-real-token");
    expect(res.status).toBe(404);
    expect(res.text).toMatch(/couldn't find this link/i);
  });

  it("returns 410 for an expired token", async () => {
    const prisma = createFakePrisma();
    const { rawToken } = seedRecord(prisma, { tokenExpiresAt: daysFromNow(-1) });
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());

    const res = await request(app).get(`/physical/${rawToken}`);
    expect(res.status).toBe(410);
    expect(res.text).toMatch(/expired/i);
  });

  it("shows a blocked page with no upload form once completed", async () => {
    const prisma = createFakePrisma();
    const { rawToken } = seedRecord(prisma, { status: "completed" });
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());

    const res = await request(app).get(`/physical/${rawToken}`);
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/already been completed/i);
    expect(res.text).not.toContain("<form");
  });

  it("shows download links and an upload form for a valid sent record", async () => {
    const prisma = createFakePrisma();
    const { rawToken } = seedRecord(prisma, { status: "sent" });
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());

    const res = await request(app).get(`/physical/${rawToken}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain(`/physical/${encodeURIComponent(rawToken)}/download?lang=en`);
    expect(res.text).toContain(`/physical/${encodeURIComponent(rawToken)}/download?lang=es`);
    expect(res.text).toContain("<form");
  });
});

describe("GET /physical/:token/download", () => {
  it("streams the English PDF by default and with lang=en", async () => {
    const prisma = createFakePrisma();
    const { rawToken } = seedRecord(prisma);
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());
    const expected = readFileSync(path.resolve(process.cwd(), "assets/forms/wellness-exam-en.pdf"));

    const res = await request(app).get(`/physical/${rawToken}/download`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toMatch(/English/);
    expect(Number(res.headers["content-length"])).toBe(expected.length);
  });

  it("streams the Spanish PDF with lang=es", async () => {
    const prisma = createFakePrisma();
    const { rawToken } = seedRecord(prisma);
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());
    const expected = readFileSync(path.resolve(process.cwd(), "assets/forms/wellness-exam-es.pdf"));

    const res = await request(app).get(`/physical/${rawToken}/download?lang=es`);
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/Spanish/);
    expect(Number(res.headers["content-length"])).toBe(expected.length);
  });

  it("blocks a download for a completed record", async () => {
    const prisma = createFakePrisma();
    const { rawToken } = seedRecord(prisma, { status: "completed" });
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());

    const res = await request(app).get(`/physical/${rawToken}/download`);
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/already been completed/i);
  });
});

describe("POST /physical/:token/upload", () => {
  it("uploads the file, marks the record received, and redirects back to the page", async () => {
    const prisma = createFakePrisma();
    const { rawToken, record } = seedRecord(prisma);
    const blobStorage = createFakeBlobStorage();
    const app = createApp(prisma as any, blobStorage, createFakeEmailSender());

    const res = await request(app)
      .post(`/physical/${rawToken}/upload`)
      .attach("form", Buffer.from("%PDF-1.4 fake content"), { filename: "signed.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(`/physical/${encodeURIComponent(rawToken)}`);

    expect(blobStorage.uploads).toHaveLength(1);
    expect(blobStorage.uploads[0].blobPath).toContain(`uploads/2026/${record.id}/`);
    expect(blobStorage.uploads[0].contentType).toBe("application/pdf");

    const updated = prisma._state.physicalRecords.find((r: any) => r.id === record.id);
    expect(updated.status).toBe("received");
    expect(updated.receivedAt).toBeInstanceOf(Date);
    expect(updated.uploadedFileUrl).toBe(`https://fake-blob.test/${blobStorage.uploads[0].blobPath}`);
    expect(updated.uploadedBlobPath).toBe(blobStorage.uploads[0].blobPath);
    expect(updated.uploadedContentType).toBe("application/pdf");
  });

  it("rejects an unsupported file type with 400 and doesn't touch the record", async () => {
    const prisma = createFakePrisma();
    const { rawToken, record } = seedRecord(prisma);
    const blobStorage = createFakeBlobStorage();
    const app = createApp(prisma as any, blobStorage, createFakeEmailSender());

    const res = await request(app)
      .post(`/physical/${rawToken}/upload`)
      .attach("form", Buffer.from("hello"), { filename: "notes.txt", contentType: "text/plain" });

    expect(res.status).toBe(400);
    expect(res.text).toMatch(/unsupported file type/i);
    expect(blobStorage.uploads).toHaveLength(0);
    const untouched = prisma._state.physicalRecords.find((r: any) => r.id === record.id);
    expect(untouched.status).toBe("sent");
  });

  it("blocks an upload for a completed record before any file parsing", async () => {
    const prisma = createFakePrisma();
    const { rawToken } = seedRecord(prisma, { status: "completed" });
    const blobStorage = createFakeBlobStorage();
    const app = createApp(prisma as any, blobStorage, createFakeEmailSender());

    const res = await request(app).post(`/physical/${rawToken}/upload`);
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/already been completed/i);
    expect(blobStorage.uploads).toHaveLength(0);
  });
});

describe("GET /physical/:token/uploaded-file", () => {
  it("404s before any file has been uploaded", async () => {
    const prisma = createFakePrisma();
    const { rawToken } = seedRecord(prisma);
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());

    const res = await request(app).get(`/physical/${rawToken}/uploaded-file`);
    expect(res.status).toBe(404);
  });

  it("streams the uploaded file with its stored content type after upload", async () => {
    const prisma = createFakePrisma();
    const { rawToken } = seedRecord(prisma);
    const blobStorage = createFakeBlobStorage();
    const app = createApp(prisma as any, blobStorage, createFakeEmailSender());

    await request(app)
      .post(`/physical/${rawToken}/upload`)
      .attach("form", Buffer.from("%PDF-1.4 fake content"), { filename: "signed.pdf", contentType: "application/pdf" });

    const res = await request(app).get(`/physical/${rawToken}/uploaded-file`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toBe("inline");
  });
});
