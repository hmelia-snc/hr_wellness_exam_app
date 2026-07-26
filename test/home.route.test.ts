import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";
import { createFakePrisma } from "./fakePrisma.js";
import { createFakeBlobStorage, createFakeEmailSender } from "./fakes.js";

describe("GET /", () => {
  it("links to the HR dashboard, since nothing else on the site does", async () => {
    const prisma = createFakePrisma();
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());

    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain('href="/dashboard"');
  });
});

describe("GET /healthz", () => {
  it("returns 200 with no dependencies, for platform health checks", async () => {
    const prisma = createFakePrisma();
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());

    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
  });
});
