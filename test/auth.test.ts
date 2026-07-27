import { describe, expect, it } from "vitest";
import request from "supertest";
import { buildEntraLogoutUrl } from "../src/routes/auth.js";
import { createApp } from "../src/server.js";
import { createFakePrisma } from "./fakePrisma.js";
import { createFakeBlobStorage, createFakeEmailSender } from "./fakes.js";

describe("buildEntraLogoutUrl", () => {
  it("points at the tenant's v2 logout endpoint with an encoded post-logout redirect", () => {
    const url = buildEntraLogoutUrl("11111111-2222-3333-4444-555555555555", "https://hr-physical-tracker.azurewebsites.net/auth/login");
    expect(url).toBe(
      "https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/oauth2/v2.0/logout?post_logout_redirect_uri=https%3A%2F%2Fhr-physical-tracker.azurewebsites.net%2Fauth%2Flogin"
    );
  });
});

describe("GET /auth/logout (AUTH_MODE=mock)", () => {
  it("destroys the session and sends the user back to /auth/login", async () => {
    const prisma = createFakePrisma();
    const app = createApp(prisma as any, createFakeBlobStorage(), createFakeEmailSender());
    const agent = request.agent(app);
    await agent.post("/auth/login").type("form").send({ returnTo: "/dashboard" });

    const loggedIn = await agent.get("/dashboard");
    expect(loggedIn.status).toBe(200);

    const logoutRes = await agent.get("/auth/logout");
    expect(logoutRes.status).toBe(302);
    expect(logoutRes.headers.location).toBe("/auth/login");

    const afterLogout = await agent.get("/dashboard");
    expect(afterLogout.status).toBe(302);
    expect(afterLogout.headers.location).toMatch(/^\/auth\/login/);
  });
});
