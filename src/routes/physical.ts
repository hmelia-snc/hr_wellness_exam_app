import path from "node:path";
import { randomUUID } from "node:crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import type { PrismaClient, PhysicalRecord, Employee } from "@prisma/client";
import { validateToken } from "../lib/tokenValidation.js";
import { renderPhysicalPage, renderBlockedPage, type PhysicalPageStatus } from "../views/physicalPage.js";
import type { BlobStorage } from "../lib/blobStorage.js";
import { getEnv } from "../config/env.js";

interface RequestWithRecord extends Request {
  physicalRecord?: PhysicalRecord;
  employee?: Employee;
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
    req.employee = result.employee;
    next();
  });

  router.get("/:token", (req: RequestWithRecord, res: Response) => {
    const record = req.physicalRecord!;
    const status = record.status as PhysicalPageStatus;
    const uploadedFile = record.uploadedContentType ? { contentType: record.uploadedContentType } : null;
    res.send(
      renderPhysicalPage(req.params.token, status, uploadedFile, {
        needsSpouseForm: req.employee!.needsSpouseForm,
        spouseReceived: Boolean(record.spouseReceivedAt),
      })
    );
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
    upload.fields([
      { name: "form", maxCount: 1 },
      { name: "spouseForm", maxCount: 1 },
    ]),
    async (req: RequestWithRecord, res: Response, next: NextFunction) => {
      try {
        const files = (req.files ?? {}) as Record<string, Express.Multer.File[] | undefined>;
        const formFile = files.form?.[0];
        const spouseFile = files.spouseForm?.[0];

        if (!formFile && !spouseFile) {
          res.status(400).send("No file uploaded.");
          return;
        }

        const record = req.physicalRecord!;
        const employee = req.employee!;

        if (spouseFile && !employee.needsSpouseForm) {
          res.status(400).send("This employee doesn't have a spouse form on file.");
          return;
        }

        if (formFile) {
          const extension = ALLOWED_MIME_TYPES[formFile.mimetype] ?? "";
          const blobPath = `uploads/${record.cycleYear}/${record.id}/${Date.now()}-${randomUUID()}${extension}`;
          const uploadedFileUrl = await blobStorage.uploadForm(formFile.buffer, blobPath, formFile.mimetype);

          await prisma.physicalRecord.update({
            where: { id: record.id },
            data: {
              uploadedFileUrl,
              uploadedBlobPath: blobPath,
              uploadedContentType: formFile.mimetype,
              status: "received",
              receivedAt: new Date(),
            },
          });

          // Step 3 (verification job) hooks in here: queue an async check of
          // signature/date fields, then transition to `completed` or `needs_review`.
          console.log(`[upload] physicalRecord=${record.id} received, blob=${blobPath}`);
        }

        if (spouseFile) {
          const extension = ALLOWED_MIME_TYPES[spouseFile.mimetype] ?? "";
          const blobPath = `uploads/${record.cycleYear}/${record.id}/spouse-${Date.now()}-${randomUUID()}${extension}`;
          const spouseUploadedFileUrl = await blobStorage.uploadForm(spouseFile.buffer, blobPath, spouseFile.mimetype);

          await prisma.physicalRecord.update({
            where: { id: record.id },
            data: {
              spouseUploadedFileUrl,
              spouseUploadedBlobPath: blobPath,
              spouseUploadedContentType: spouseFile.mimetype,
              spouseReceivedAt: new Date(),
            },
          });

          console.log(`[upload] physicalRecord=${record.id} spouse form received, blob=${blobPath}`);
        }

        res.redirect(303, `/physical/${encodeURIComponent(req.params.token)}`);
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
