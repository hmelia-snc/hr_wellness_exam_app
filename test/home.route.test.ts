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

describe("GET /", () => {
  it("links to the HR dashboard, since nothing else on the site does", async () => {
    const prisma = createFakePrisma();
    const app = createApp(prisma as any, fakeBlobStorage());

    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain('href="/dashboard"');
  });
});

describe("GET /healthz", () => {
  it("returns 200 with no dependencies, for platform health checks", async () => {
    const prisma = createFakePrisma();
    const app = createApp(prisma as any, fakeBlobStorage());

    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
  });
});
