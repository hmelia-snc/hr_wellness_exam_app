import path from "node:path";
import express, { type Request, type Response, type NextFunction } from "express";
import session from "express-session";
import rateLimit from "express-rate-limit";
import { MulterError } from "multer";
import type { PrismaClient } from "@prisma/client";
import { createPhysicalRouter } from "./routes/physical.js";
import { createAuthRouter } from "./routes/auth.js";
import { createDashboardRouter } from "./routes/dashboard.js";
import { createEmployeesRouter } from "./routes/employees.js";
import type { BlobStorage } from "./lib/blobStorage.js";
import type { EmailSender } from "./lib/email/types.js";
import type { FormVerifier } from "./lib/verification/types.js";
import { getEnv } from "./config/env.js";
import { renderHomePage } from "./views/homePage.js";

export function createApp(
  prisma: PrismaClient,
  blobStorage: BlobStorage,
  emailSender: EmailSender,
  formVerifier?: FormVerifier
) {
  const app = express();
  const env = getEnv();

  // App Service (and most PaaS hosts) sit behind a reverse proxy; without
  // this, req.secure is always false, so the session cookie's
  // secure:NODE_ENV==='production' below would never actually apply.
  app.set("trust proxy", 1);

  app.get("/healthz", (_req: Request, res: Response) => {
    res.status(200).send("ok");
  });

  app.use("/branding", express.static(path.resolve(process.cwd(), "assets/branding")));

  app.use(
    session({
      secret: env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: env.NODE_ENV === "production",
      },
    })
  );
  app.use(express.urlencoded({ extended: false }));

  // Spec requirement: rate-limit the token-based upload/download endpoints
  // to blunt token-enumeration attempts.
  const physicalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.get("/", (_req: Request, res: Response) => {
    res.send(renderHomePage());
  });

  app.use("/physical", physicalLimiter, createPhysicalRouter(prisma, blobStorage, formVerifier));
  app.use("/auth", createAuthRouter());
  app.use("/dashboard", createDashboardRouter(prisma, emailSender));
  app.use("/dashboard/employees", createEmployeesRouter(prisma, emailSender, blobStorage));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof MulterError && err.code === "LIMIT_FILE_SIZE") {
      res.status(413).send("File too large.");
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unsupported file type")) {
      res.status(400).send(err.message);
      return;
    }
    console.error(err);
    res.status(500).send("Something went wrong.");
  });

  return app;
}
