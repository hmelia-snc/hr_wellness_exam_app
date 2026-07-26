import path from "node:path";
import { randomUUID } from "node:crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { z } from "zod";
import type { PrismaClient, PhysicalRecord } from "@prisma/client";
import { validateToken } from "../lib/tokenValidation.js";
import { renderPhysicalPage, renderBlockedPage, type PhysicalPageStatus } from "../views/physicalPage.js";
import type { BlobStorage } from "../lib/blobStorage.js";
import { getEnv } from "../config/env.js";

interface RequestWithRecord extends Request {
  physicalRecord?: PhysicalRecord;
}

const FORM_FILES = {
  en: {
    filePath: path.resolve(process.cwd(), "assets/forms/wellness-exam-en.pdf"),
    filename: "Wellness-Exam-Verification-Form-English.pdf",
  },
  es: {
    filePath: path.resolve(process.cwd(), "assets/forms/wellness-exam-es.pdf"),
    filename: "Wellness-Exam-Verification-Form-Spanish.pdf",
  },
} as const;

const ALLOWED_MIME_TYPES: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
};

const uploadFieldsSchema = z.object({
  firstName: z.string({ required_error: "First name is required." }).trim().min(1, "First name is required."),
  lastName: z.string({ required_error: "Last name is required." }).trim().min(1, "Last name is required."),
  email: z.string({ required_error: "A valid email is required." }).trim().email("A valid email is required."),
});

export function createPhysicalRouter(prisma: PrismaClient, blobStorage: BlobStorage): Router {
  const router = Router();
  const env = getEnv();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024 },
    fileFilter: (_req, file, callback) => {
      if (!(file.mimetype in ALLOWED_MIME_TYPES)) {
        callback(new Error("Unsupported file type — please upload a PDF, JPG, or PNG."));
        return;
      }
      callback(null, true);
    },
  });

  // Runs once per request for any route with a :token param, before the
  // route-specific handler (and before multer buffers an upload body), so an
  // invalid/expired/completed token is rejected without doing further work.
  router.param("token", async (req: RequestWithRecord, res: Response, next: NextFunction, rawToken: string) => {
    const result = await validateToken(prisma, rawToken);
    if (result.kind === "not_found") {
      res.status(404).send(renderBlockedPage("not_found"));
      return;
    }
    if (result.kind === "expired") {
      res.status(410).send(renderBlockedPage("expired"));
      return;
    }
    if (result.kind === "completed") {
      res.status(200).send(renderBlockedPage("completed"));
      return;
    }
    req.physicalRecord = result.record;
    next();
  });

  router.get("/:token", (req: RequestWithRecord, res: Response) => {
    const record = req.physicalRecord!;
    const status = record.status as PhysicalPageStatus;
    const uploadedFile = record.uploadedContentType ? { contentType: record.uploadedContentType } : null;
    res.send(renderPhysicalPage(req.params.token, status, uploadedFile));
  });

  router.get("/:token/download", (req: RequestWithRecord, res: Response) => {
    const lang = req.query.lang === "es" ? "es" : "en";
    const file = FORM_FILES[lang];
    res.download(file.filePath, file.filename);
  });

  router.get("/:token/uploaded-file", async (req: RequestWithRecord, res: Response, next: NextFunction) => {
    try {
      const record = req.physicalRecord!;
      if (!record.uploadedBlobPath) {
        res.status(404).send("No uploaded file yet.");
        return;
      }
      const buffer = await blobStorage.downloadForm(record.uploadedBlobPath);
      res.setHeader("Content-Type", record.uploadedContentType ?? "application/octet-stream");
      res.setHeader("Content-Disposition", "inline");
      res.send(buffer);
    } catch (err) {
      next(err);
    }
  });

  router.post(
    "/:token/upload",
    upload.single("form"),
    async (req: RequestWithRecord, res: Response, next: NextFunction) => {
      try {
        const fields = uploadFieldsSchema.safeParse(req.body);
        if (!fields.success) {
          res.status(400).send(fields.error.issues.map((issue) => issue.message).join(" "));
          return;
        }
        if (!req.file) {
          res.status(400).send("No file uploaded.");
          return;
        }
        const record = req.physicalRecord!;
        const extension = ALLOWED_MIME_TYPES[req.file.mimetype] ?? "";
        const blobPath = `uploads/${record.cycleYear}/${record.id}/${Date.now()}-${randomUUID()}${extension}`;
        const uploadedFileUrl = await blobStorage.uploadForm(req.file.buffer, blobPath, req.file.mimetype);

        await prisma.physicalRecord.update({
          where: { id: record.id },
          data: {
            uploadedFileUrl,
            uploadedBlobPath: blobPath,
            uploadedContentType: req.file.mimetype,
            uploaderFirstName: fields.data.firstName,
            uploaderLastName: fields.data.lastName,
            uploaderEmail: fields.data.email,
            status: "received",
            receivedAt: new Date(),
          },
        });

        // Step 3 (verification job) hooks in here: queue an async check of
        // signature/date fields, then transition to `completed` or `needs_review`.
        console.log(`[upload] physicalRecord=${record.id} received, blob=${blobPath}`);

        res.redirect(303, `/physical/${encodeURIComponent(req.params.token)}`);
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
