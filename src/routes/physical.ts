import path from "node:path";
import { randomUUID } from "node:crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import type { PrismaClient, PhysicalRecord, Employee } from "@prisma/client";
import { validateToken } from "../lib/tokenValidation.js";
import { renderPhysicalPage, renderBlockedPage, type PhysicalPageStatus } from "../views/physicalPage.js";
import type { BlobStorage } from "../lib/blobStorage.js";
import type { EmailSender } from "../lib/email/types.js";
import type { FormVerifier } from "../lib/verification/types.js";
import { verifyPhysicalRecord } from "../services/verifyRecord.js";
import { recordFileAccess } from "../services/fileAccessLog.js";
import { ensureSpousePhysicalRecordForCycle } from "../services/employeeActions.js";
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

export function createPhysicalRouter(
  prisma: PrismaClient,
  blobStorage: BlobStorage,
  emailSender: EmailSender,
  formVerifier?: FormVerifier
): Router {
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
    try {
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
    } catch (err) {
      next(err);
    }
  });

  router.get("/:token", async (req: RequestWithRecord, res: Response, next: NextFunction) => {
    try {
      const record = req.physicalRecord!;
      const employee = req.employee!;
      const status = record.status as PhysicalPageStatus;
      const uploadedFile = record.uploadedContentType ? { contentType: record.uploadedContentType } : null;

      // New model: a linked spouse roster row tracks its own PhysicalRecord
      // rather than the embedded spouse* fields on this record — show the
      // spouse field for either case, and resolve "received" from whichever
      // one applies.
      const linkedSpouse = await prisma.employee.findFirst({
        where: { recordType: "spouse", linkedEmployeeId: employee.id },
      });
      let spouseReceived = Boolean(record.spouseReceivedAt);
      if (linkedSpouse) {
        const spouseRecord = await prisma.physicalRecord.findUnique({
          where: { employeeId_cycleYear: { employeeId: linkedSpouse.id, cycleYear: record.cycleYear } },
        });
        spouseReceived = Boolean(spouseRecord?.receivedAt);
      }

      res.send(
        renderPhysicalPage(req.params.token, status, uploadedFile, {
          needsSpouseForm: employee.needsSpouseForm || Boolean(linkedSpouse),
          spouseReceived,
        })
      );
    } catch (err) {
      next(err);
    }
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
      // Only an actual employee-type record's token is ever emailed/used to
      // view a file this way, and that record type always has an email —
      // the fallback below is defensive, not an expected case.
      await recordFileAccess(prisma, record.id, "employee", req.employee!.email ?? "unknown");
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

        // New model: a linked spouse roster row (recordType "spouse") tracks
        // its own PhysicalRecord for this cycle instead of the embedded
        // spouse* fields on this record — the old model, still used
        // unchanged below for any employee with needsSpouseForm but no
        // linked row.
        const linkedSpouse = await prisma.employee.findFirst({
          where: { recordType: "spouse", linkedEmployeeId: employee.id },
        });
        const usesLinkedSpouseRecord = Boolean(linkedSpouse);

        if (spouseFile && !employee.needsSpouseForm && !usesLinkedSpouseRecord) {
          res.status(400).send("This employee doesn't have a spouse form on file.");
          return;
        }

        let spousePhysicalRecordId: string | null = null;
        let spouseAlreadyReceivedAt: Date | null = null;
        if (linkedSpouse) {
          const ensured = await ensureSpousePhysicalRecordForCycle(prisma, linkedSpouse.id, record.cycleYear);
          spousePhysicalRecordId = ensured.physicalRecordId;
          const existingSpouseRecord = await prisma.physicalRecord.findUnique({ where: { id: ensured.physicalRecordId } });
          spouseAlreadyReceivedAt = existingSpouseRecord?.receivedAt ?? null;
        }

        // Computed once up front so both confirmation emails below agree on
        // whether the cycle is now fully satisfied — a form present in
        // *this* request counts as done even though the DB update for it
        // hasn't landed yet at this point in the handler.
        const employeeFormDone = Boolean(formFile) || Boolean(record.receivedAt);
        const spouseFormDone = usesLinkedSpouseRecord
          ? Boolean(spouseFile) || Boolean(spouseAlreadyReceivedAt)
          : !employee.needsSpouseForm || Boolean(spouseFile) || Boolean(record.spouseReceivedAt);
        const isComplete = employeeFormDone && spouseFormDone;
        const uploadPageLink = `${env.APP_BASE_URL}/wellness-exam/${encodeURIComponent(req.params.token)}`;

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
              // A resubmission after a rejection clears the old reason —
              // it's no longer accurate once a new file is in for review.
              rejectionReason: null,
            },
          });

          console.log(`[upload] physicalRecord=${record.id} received, blob=${blobPath}`);

          // Fire-and-forget: OCR verification can take several seconds for
          // the real Azure verifier, and the employee shouldn't wait on it.
          if (formVerifier) {
            verifyPhysicalRecord(prisma, formVerifier, record.id, blobPath, formFile.buffer, formFile.mimetype, record.cycleYear).catch(
              (err) => {
                console.error(
                  `[upload] verification kickoff failed for record=${record.id}:`,
                  err instanceof Error ? err.message : err
                );
              }
            );
          }

          // Fire-and-forget, same reasoning: a slow/failed confirmation
          // email shouldn't hold up or fail the employee's upload response.
          // No email on file only happens for a spouse's own token, which
          // never reaches here (spouses submit through the employee's link).
          if (employee.email) {
            emailSender
              .sendUploadConfirmation({
                toEmail: employee.email,
                toName: employee.fullName,
                cycleYear: record.cycleYear,
                submitterRole: "employee",
                isComplete,
                link: uploadPageLink,
              })
              .catch((err) => {
                console.error(
                  `[upload] confirmation email failed for record=${record.id}:`,
                  err instanceof Error ? err.message : err
                );
              });
          }
        }

        if (spouseFile) {
          const extension = ALLOWED_MIME_TYPES[spouseFile.mimetype] ?? "";
          const blobPath = `uploads/${record.cycleYear}/${record.id}/spouse-${Date.now()}-${randomUUID()}${extension}`;
          const spouseUploadedFileUrl = await blobStorage.uploadForm(spouseFile.buffer, blobPath, spouseFile.mimetype);

          if (usesLinkedSpouseRecord && spousePhysicalRecordId) {
            // New model: write to the linked spouse's own PhysicalRecord
            // using the same regular fields any employee upload uses —
            // this is what lets OCR verification and the normal
            // approve/reject actions apply to a spouse's upload too.
            await prisma.physicalRecord.update({
              where: { id: spousePhysicalRecordId },
              data: {
                uploadedFileUrl: spouseUploadedFileUrl,
                uploadedBlobPath: blobPath,
                uploadedContentType: spouseFile.mimetype,
                status: "received",
                receivedAt: new Date(),
                rejectionReason: null,
              },
            });

            console.log(`[upload] physicalRecord=${spousePhysicalRecordId} (linked spouse) received, blob=${blobPath}`);

            if (formVerifier) {
              verifyPhysicalRecord(
                prisma,
                formVerifier,
                spousePhysicalRecordId,
                blobPath,
                spouseFile.buffer,
                spouseFile.mimetype,
                record.cycleYear
              ).catch((err) => {
                console.error(
                  `[upload] spouse verification kickoff failed for record=${spousePhysicalRecordId}:`,
                  err instanceof Error ? err.message : err
                );
              });
            }
          } else {
            // Old embedded model: no linked spouse row, just the
            // needsSpouseForm boolean — write the spouse's upload directly
            // onto this record's spouse* fields, unchanged.
            await prisma.physicalRecord.update({
              where: { id: record.id },
              data: {
                spouseUploadedFileUrl,
                spouseUploadedBlobPath: blobPath,
                spouseUploadedContentType: spouseFile.mimetype,
                spouseReceivedAt: new Date(),
                spouseStatus: "received",
                // A resubmission after a rejection clears the old reason —
                // it's no longer accurate once a new file is in for review.
                spouseRejectionReason: null,
              },
            });

            console.log(`[upload] physicalRecord=${record.id} spouse form received, blob=${blobPath}`);
          }

          // The spouse has no email of their own either way — this
          // confirmation always goes to the employee, letting them know
          // their spouse's form came in.
          if (employee.email) {
            emailSender
              .sendUploadConfirmation({
                toEmail: employee.email,
                toName: employee.fullName,
                cycleYear: record.cycleYear,
                submitterRole: "spouse",
                isComplete,
                link: uploadPageLink,
              })
              .catch((err) => {
                console.error(
                  `[upload] spouse confirmation email failed for record=${record.id}:`,
                  err instanceof Error ? err.message : err
                );
              });
          }
        }

        res.redirect(303, `/wellness-exam/${encodeURIComponent(req.params.token)}`);
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
