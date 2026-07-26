import { Router, type Request, type Response, type NextFunction } from "express";
import { ConfidentialClientApplication } from "@azure/msal-node";
import { getEnv } from "../config/env.js";
import { escapeHtml } from "../lib/html.js";
import { renderLayout } from "../views/layout.js";
import type { HrUser } from "../lib/auth.js";

function safeReturnTo(value: unknown): string {
  // Only allow same-origin relative paths, never an absolute/external URL.
  return typeof value === "string" && value.startsWith("/") ? value : "/dashboard";
}

export function createAuthRouter(): Router {
  const router = Router();
  const env = getEnv();

  if (env.AUTH_MODE === "mock") {
    router.get("/login", (req: Request, res: Response) => {
      const returnTo = safeReturnTo(req.query.returnTo);
      res.send(
        renderLayout(
          "HR Sign In (Dev)",
          `
<h1>Dev Sign-In</h1>
<p><strong>AUTH_MODE=mock</strong> — this is a local development bypass, not real
authentication. The app refuses to start this way when NODE_ENV=production.</p>
<form method="post" action="/auth/login">
  <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}" />
  <button type="submit">Sign in as Dev HR User</button>
</form>
`
        )
      );
    });

    router.post("/login", (req: Request, res: Response) => {
      const hrUser: HrUser = { name: "Dev HR User", email: "dev-hr@standardnutrition.com" };
      req.session.hrUser = hrUser;
      res.redirect(safeReturnTo(req.body?.returnTo));
    });
  } else {
    const msalClient = new ConfidentialClientApplication({
      auth: {
        clientId: env.ENTRA_CLIENT_ID!,
        authority: `https://login.microsoftonline.com/${env.ENTRA_TENANT_ID}`,
        clientSecret: env.ENTRA_CLIENT_SECRET!,
      },
    });

    router.get("/login", async (req: Request, res: Response, next: NextFunction) => {
      try {
        const returnTo = safeReturnTo(req.query.returnTo);
        const url = await msalClient.getAuthCodeUrl({
          scopes: ["User.Read"],
          redirectUri: env.ENTRA_REDIRECT_URI!,
          state: encodeURIComponent(returnTo),
        });
        res.redirect(url);
      } catch (err) {
        next(err);
      }
    });

    router.get("/callback", async (req: Request, res: Response, next: NextFunction) => {
      try {
        const code = req.query.code;
        if (typeof code !== "string") {
          res.status(400).send("Missing authorization code.");
          return;
        }
        const result = await msalClient.acquireTokenByCode({
          code,
          scopes: ["User.Read"],
          redirectUri: env.ENTRA_REDIRECT_URI!,
        });
        const claims = result?.idTokenClaims as Record<string, unknown> | undefined;
        if (!claims) {
          res.status(401).send("Sign-in failed.");
          return;
        }
        if (env.HR_GROUP_OBJECT_ID) {
          const groups = Array.isArray(claims.groups) ? (claims.groups as string[]) : [];
          if (!groups.includes(env.HR_GROUP_OBJECT_ID)) {
            res.status(403).send("Your account is not a member of the HR group required for dashboard access.");
            return;
          }
        }
        req.session.hrUser = {
          name: (claims.name as string | undefined) ?? (claims.preferred_username as string | undefined) ?? "HR User",
          email: (claims.preferred_username as string | undefined) ?? (claims.email as string | undefined) ?? "",
        };
        res.redirect(safeReturnTo(typeof req.query.state === "string" ? decodeURIComponent(req.query.state) : undefined));
      } catch (err) {
        next(err);
      }
    });
  }

  router.get("/logout", (req: Request, res: Response, next: NextFunction) => {
    req.session.destroy((err) => {
      if (err) {
        next(err);
        return;
      }
      res.redirect("/auth/login");
    });
  });

  return router;
}
