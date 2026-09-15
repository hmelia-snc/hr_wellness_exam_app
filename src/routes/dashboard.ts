import { Router, type Request, type Response, type NextFunction } from "express";
import type { PrismaClient } from "@prisma/client";
import { requireHrAuth } from "../lib/auth.js";
import { renderDashboardPage } from "../views/dashboardPage.js";
import { renderShareableLinkPage } from "../views/shareableLinkPage.js";
import type { EmailSender } from "../lib/email/types.js";
import type { BlobStorage } from "../lib/blobStorage.js";
import { resendLink, getShareableLink, rejectRecord, approveRecord } from "../services/employeeActions.js";
import { recordFileAccess } from "../services/fileAccessLog.js";
import { buildCsv } from "../lib/csv.js";
import { toIdArray } from "../lib/requestArrays.js";

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

// `Number(x) || undefined` would treat a legitimate 0 (e.g. every selected
// record was skipped) the same as "absent", hiding the bulk-result notice
// entirely — check presence in the query string first instead.
function queryNumber(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

// Shape common to both the dashboard list and CSV export queries — just
// enough for computeDisplayStatuses below, regardless of what else each
// caller's `include`/`select` pulls in.
interface RecordForStatus {
  employeeId: string;
  status: string;
  employee: {
    recordType: string;
    spouseRecords: { id: string }[];
  };
}

/**
 * Derives a display status that overrides a literally-"completed" record to
 * "waiting_on_spouse" when the employee's own form is done but the linked
 * spouse's own PhysicalRecord for the same cycle isn't yet. Every other
 * status passes through unchanged, and a spouse's own row is never
 * overridden (no "waiting on employee" case is needed by symmetry — only
 * asked for this direction). This is purely a display-layer label: the
 * underlying `status` column, which button eligibility and other logic
 * still key off, is untouched.
 */
function withDisplayStatuses<T extends RecordForStatus>(records: T[]): (T & { displayStatus: string })[] {
  const statusByEmployeeId = new Map(records.map((r) => [r.employeeId, r.status]));
  return records.map((record) => {
    const { employee } = record;
    let displayStatus = record.status;
    if (record.status === "completed" && employee.recordType !== "spouse") {
      const linkedSpouseEmployeeId = employee.spouseRecords[0]?.id;
      if (linkedSpouseEmployeeId && statusByEmployeeId.get(linkedSpouseEmployeeId) !== "completed") {
        displayStatus = "waiting_on_spouse";
      }
    }
    return { ...record, displayStatus };
  });
}

// The dashboard already hides the Resend/Get Link/Reject buttons (and
// disables the bulk-select checkbox) for inactive employees, but that's
// client-side only — a crafted direct POST, or a bulk request, could still
// hit one of these routes for an inactive employee's record. Since these
// actions email the employee and/or regenerate their token, re-check
// server-side rather than trusting the client to have honored the hidden
// button / disabled checkbox.
async function isRecordsEmployeeActive(prisma: PrismaClient, physicalRecordId: string): Promise<boolean> {
  const record = await prisma.physicalRecord.findUnique({ where: { id: physicalRecordId } });
  if (!record) return false;
  const employee = await prisma.employee.findUnique({ where: { id: record.employeeId } });
  return employee?.active ?? false;
}

export function createDashboardRouter(prisma: PrismaClient, emailSender: EmailSender, blobStorage: BlobStorage): Router {
  const router = Router();

  router.get("/", requireHrAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { cycleYear, statusFilter } = cycleYearAndStatusFilter(req);

      // Fetched unfiltered by status (filtering happens below, against the
      // derived displayStatus) — a "completed" filter needs to tell a truly
      // finished record apart from one waiting on its spouse, and computing
      // that for an employee's row requires the linked spouse's own record
      // (also cycle-scoped) to already be in hand.
      const [allRecords, distinctYears] = await Promise.all([
        prisma.physicalRecord.findMany({
          where: { cycleYear },
          include: {
            employee: {
              include: { linkedEmployee: { select: { fullName: true } }, spouseRecords: { select: { id: true } } },
            },
          },
          orderBy: { createdAt: "asc" },
        }),
        prisma.physicalRecord.findMany({ select: { cycleYear: true }, distinct: ["cycleYear"] }),
      ]);
      // Always offer the current calendar year even before any cycle has been
      // started for it, so HR can find it in the selector to kick one off.
      const availableYears = [...new Set([...distinctYears.map((r) => r.cycleYear), new Date().getFullYear(), cycleYear])].sort(
        (a, b) => b - a
      );

      const records = withDisplayStatuses(allRecords).filter((r) => !statusFilter || r.displayStatus === statusFilter);

      res.send(
        renderDashboardPage({
          hrUser: req.session.hrUser!,
          cycleYear,
          availableYears,
          statusFilter,
          resendFailed: req.query.resendFailed === "1",
          rejectEmailFailed: req.query.rejectEmailFailed === "1",
          bulkApproved: queryNumber(req.query.bulkApproved),
          bulkResent: queryNumber(req.query.bulkResent),
          bulkResentFailed: queryNumber(req.query.bulkResentFailed),
          bulkResentSkipped: queryNumber(req.query.bulkResentSkipped),
          bulkRejected: queryNumber(req.query.bulkRejected),
          bulkRejectedFailed: queryNumber(req.query.bulkRejectedFailed),
          bulkRejectedSkipped: queryNumber(req.query.bulkRejectedSkipped),
          records: records.map((record) => ({
            id: record.id,
            employeeName: record.employee.fullName,
            employeeEmail: record.employee.email,
            employeeActive: record.employee.active,
            recordType: record.employee.recordType === "spouse" ? ("spouse" as const) : ("employee" as const),
            linkedEmployeeName: record.employee.linkedEmployee?.fullName ?? null,
            status: record.status,
            displayStatus: record.displayStatus,
            sentAt: record.sentAt,
            receivedAt: record.receivedAt,
            completedAt: record.completedAt,
            verificationResult: record.verificationResult,
            rejectionReason: record.rejectionReason,
            hasUploadedFile: Boolean(record.uploadedBlobPath),
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

      const allRecords = await prisma.physicalRecord.findMany({
        where: { cycleYear },
        include: { employee: { include: { spouseRecords: { select: { id: true } } } } },
        orderBy: { createdAt: "asc" },
      });
      const records = withDisplayStatuses(allRecords).filter((r) => !statusFilter || r.displayStatus === statusFilter);

      const formatDate = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : "");
      const csv = buildCsv(
        ["Employee", "Email", "Record Type", "Status", "Sent", "Received", "Completed", "Verification Result", "Rejection Reason"],
        records.map((r) => [
          r.employee.fullName,
          r.employee.email ?? "",
          r.employee.recordType === "spouse" ? "spouse" : "employee",
          r.displayStatus,
          formatDate(r.sentAt),
          formatDate(r.receivedAt),
          formatDate(r.completedAt),
          r.verificationResult ?? "",
          r.rejectionReason ?? "",
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

  router.post("/records/:id/resend", requireHrAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!(await isRecordsEmployeeActive(prisma, req.params.id))) {
        res.redirect(303, backToDashboardHref(req));
        return;
      }
      const result = await resendLink(prisma, emailSender, req.params.id);
      res.redirect(303, backToDashboardHref(req, result.emailSent ? {} : { resendFailed: "1" }));
    } catch (err) {
      next(err);
    }
  });

  router.post("/records/:id/approve", requireHrAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!(await isRecordsEmployeeActive(prisma, req.params.id))) {
        res.redirect(303, backToDashboardHref(req));
        return;
      }
      await approveRecord(prisma, req.params.id, req.session.hrUser!.email);
      res.redirect(303, backToDashboardHref(req));
    } catch (err) {
      next(err);
    }
  });

  router.post("/records/:id/reject", requireHrAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!(await isRecordsEmployeeActive(prisma, req.params.id))) {
        res.redirect(303, backToDashboardHref(req));
        return;
      }
      const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
      if (!reason) {
        res.status(400).send("A rejection reason is required.");
        return;
      }
      const result = await rejectRecord(prisma, emailSender, req.params.id, reason, req.session.hrUser!.email);
      res.redirect(303, backToDashboardHref(req, result.emailSent ? {} : { rejectEmailFailed: "1" }));
    } catch (err) {
      next(err);
    }
  });

  router.post("/records/:id/link", requireHrAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!(await isRecordsEmployeeActive(prisma, req.params.id))) {
        res.redirect(303, backToDashboardHref(req));
        return;
      }
      const result = await getShareableLink(prisma, req.params.id);
      res.send(
        renderShareableLinkPage({
          link: result.link,
          employeeName: result.employeeName,
          employeeEmail: result.employeeEmail,
          cycleYear: result.cycleYear,
          regenerated: result.regenerated,
          backHref: backToDashboardHref(req),
        })
      );
    } catch (err) {
      next(err);
    }
  });

  router.post("/bulk/approve", requireHrAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ids = toIdArray(req.body?.ids);
      const hrEmail = req.session.hrUser!.email;
      for (const id of ids) {
        await approveRecord(prisma, id, hrEmail);
      }
      res.redirect(303, backToDashboardHref(req, { bulkApproved: String(ids.length) }));
    } catch (err) {
      next(err);
    }
  });

  router.post("/bulk/resend", requireHrAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ids = toIdArray(req.body?.ids);
      let processed = 0;
      let emailFailed = 0;
      for (const id of ids) {
        if (!(await isRecordsEmployeeActive(prisma, id))) continue;
        processed++;
        const result = await resendLink(prisma, emailSender, id);
        if (!result.emailSent) emailFailed++;
      }
      res.redirect(
        303,
        backToDashboardHref(req, {
          bulkResent: String(processed),
          bulkResentFailed: String(emailFailed),
          bulkResentSkipped: String(ids.length - processed),
        })
      );
    } catch (err) {
      next(err);
    }
  });

  router.post("/bulk/reject", requireHrAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ids = toIdArray(req.body?.ids);
      const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
      if (!reason) {
        res.status(400).send("A rejection reason is required.");
        return;
      }
      const hrEmail = req.session.hrUser!.email;
      let processed = 0;
      let emailFailed = 0;
      for (const id of ids) {
        if (!(await isRecordsEmployeeActive(prisma, id))) continue;
        processed++;
        const result = await rejectRecord(prisma, emailSender, id, reason, hrEmail);
        if (!result.emailSent) emailFailed++;
      }
      res.redirect(
        303,
        backToDashboardHref(req, {
          bulkRejected: String(processed),
          bulkRejectedFailed: String(emailFailed),
          bulkRejectedSkipped: String(ids.length - processed),
        })
      );
    } catch (err) {
      next(err);
    }
  });

  return router;
}
