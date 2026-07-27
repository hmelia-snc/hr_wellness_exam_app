import { Router, type Request, type Response, type NextFunction } from "express";
import type { PrismaClient } from "@prisma/client";
import { requireHrAuth } from "../lib/auth.js";
import { renderDashboardPage } from "../views/dashboardPage.js";
import { renderShareableLinkPage } from "../views/shareableLinkPage.js";
import type { EmailSender } from "../lib/email/types.js";
import type { BlobStorage } from "../lib/blobStorage.js";
import { resendLink, generateShareableLink } from "../services/employeeActions.js";
import { recordFileAccess } from "../services/fileAccessLog.js";
import { buildCsv } from "../lib/csv.js";

function backToDashboardHref(req: Request, extra: Record<string, string> = {}): string {
  const year = typeof req.query.year === "string" ? req.query.year : undefined;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const params = new URLSearchParams();
  if (year) params.set("year", year);
  if (status) params.set("status", status);
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  const qs = params.toString();
  return `/dashboard${qs ? `?${qs}` : ""}`;
}

function cycleYearAndStatusFilter(req: Request): { cycleYear: number; statusFilter?: string } {
  const cycleYear = Number(req.query.year) || new Date().getFullYear();
  const statusFilter = typeof req.query.status === "string" ? req.query.status : undefined;
  return { cycleYear, statusFilter };
}

export function createDashboardRouter(prisma: PrismaClient, emailSender: EmailSender, blobStorage: BlobStorage): Router {
  const router = Router();

  router.get("/", requireHrAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { cycleYear, statusFilter } = cycleYearAndStatusFilter(req);

      const [records, distinctYears] = await Promise.all([
        prisma.physicalRecord.findMany({
          where: { cycleYear, ...(statusFilter ? { status: statusFilter } : {}) },
          include: { employee: true },
          orderBy: { createdAt: "asc" },
        }),
        prisma.physicalRecord.findMany({ select: { cycleYear: true }, distinct: ["cycleYear"] }),
      ]);
      // Always offer the current calendar year even before any cycle has been
      // started for it, so HR can find it in the selector to kick one off.
      const availableYears = [...new Set([...distinctYears.map((r) => r.cycleYear), new Date().getFullYear(), cycleYear])].sort(
        (a, b) => b - a
      );

      res.send(
        renderDashboardPage({
          hrUser: req.session.hrUser!,
          cycleYear,
          availableYears,
          statusFilter,
          resendFailed: req.query.resendFailed === "1",
          records: records.map((record) => ({
            id: record.id,
            employeeName: record.employee.fullName,
            employeeEmail: record.employee.email,
            employeeActive: record.employee.active,
            status: record.status,
            sentAt: record.sentAt,
            receivedAt: record.receivedAt,
            completedAt: record.completedAt,
            needsSpouseForm: record.employee.needsSpouseForm,
            spouseReceivedAt: record.spouseReceivedAt,
            verificationResult: record.verificationResult,
            hasUploadedFile: Boolean(record.uploadedBlobPath),
            hasSpouseFile: Boolean(record.spouseUploadedBlobPath),
          })),
        })
      );
    } catch (err) {
      next(err);
    }
  });

  router.get("/export", requireHrAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { cycleYear, statusFilter } = cycleYearAndStatusFilter(req);

      const records = await prisma.physicalRecord.findMany({
        where: { cycleYear, ...(statusFilter ? { status: statusFilter } : {}) },
        include: { employee: true },
        orderBy: { createdAt: "asc" },
      });

      const formatDate = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : "");
      const csv = buildCsv(
        ["Employee", "Email", "Status", "Sent", "Received", "Completed", "Needs Spouse Form", "Spouse Received", "Verification Result"],
        records.map((r) => [
          r.employee.fullName,
          r.employee.email,
          r.status,
          formatDate(r.sentAt),
          formatDate(r.receivedAt),
          formatDate(r.completedAt),
          r.employee.needsSpouseForm ? "yes" : "no",
          formatDate(r.spouseReceivedAt),
          r.verificationResult ?? "",
        ])
      );

      res.type("text/csv").attachment(`hr-dashboard-${cycleYear}${statusFilter ? `-${statusFilter}` : ""}.csv`).send(csv);
    } catch (err) {
      next(err);
    }
  });

  router.get("/records/:id/file", requireHrAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const record = await prisma.physicalRecord.findUnique({ where: { id: req.params.id } });
      if (!record?.uploadedBlobPath) {
        res.status(404).send("No uploaded file for this record.");
        return;
      }
      const buffer = await blobStorage.downloadForm(record.uploadedBlobPath);
      await recordFileAccess(prisma, record.id, "employee", req.session.hrUser!.email);
      res.setHeader("Content-Type", record.uploadedContentType ?? "application/octet-stream");
      res.setHeader("Content-Disposition", "inline");
      res.send(buffer);
    } catch (err) {
      next(err);
    }
  });

  router.get("/records/:id/spouse-file", requireHrAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const record = await prisma.physicalRecord.findUnique({ where: { id: req.params.id } });
      if (!record?.spouseUploadedBlobPath) {
        res.status(404).send("No uploaded spouse file for this record.");
        return;
      }
      const buffer = await blobStorage.downloadForm(record.spouseUploadedBlobPath);
      await recordFileAccess(prisma, record.id, "spouse", req.session.hrUser!.email);
      res.setHeader("Content-Type", record.spouseUploadedContentType ?? "application/octet-stream");
      res.setHeader("Content-Disposition", "inline");
      res.send(buffer);
    } catch (err) {
      next(err);
    }
  });

  router.post("/records/:id/resend", requireHrAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await resendLink(prisma, emailSender, req.params.id);
      res.redirect(303, backToDashboardHref(req, result.emailSent ? {} : { resendFailed: "1" }));
    } catch (err) {
      next(err);
    }
  });

  router.post("/records/:id/approve", requireHrAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const hrEmail = req.session.hrUser!.email;
      await prisma.physicalRecord.update({
        where: { id: req.params.id },
        data: {
          status: "completed",
          completedAt: new Date(),
          reviewedBy: hrEmail,
          reviewedAt: new Date(),
          verificationResult: `Manually approved by ${hrEmail}.`,
        },
      });
      res.redirect(303, backToDashboardHref(req));
    } catch (err) {
      next(err);
    }
  });

  router.post("/records/:id/link", requireHrAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await generateShareableLink(prisma, req.params.id);
      res.send(
        renderShareableLinkPage({
          link: result.link,
          employeeName: result.employeeName,
          employeeEmail: result.employeeEmail,
          cycleYear: result.cycleYear,
          backHref: backToDashboardHref(req),
        })
      );
    } catch (err) {
      next(err);
    }
  });

  return router;
}
