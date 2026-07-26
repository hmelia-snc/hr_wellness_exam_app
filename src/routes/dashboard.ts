import { Router, type Request, type Response, type NextFunction } from "express";
import type { PrismaClient } from "@prisma/client";
import { requireHrAuth } from "../lib/auth.js";
import { renderDashboardPage } from "../views/dashboardPage.js";
import type { EmailSender } from "../lib/email/types.js";
import { resendLink } from "../services/employeeActions.js";

export function createDashboardRouter(prisma: PrismaClient, emailSender: EmailSender): Router {
  const router = Router();

  router.get("/", requireHrAuth, async (req: Request, res: Response) => {
    const cycleYear = Number(req.query.year) || new Date().getFullYear();
    const statusFilter = typeof req.query.status === "string" ? req.query.status : undefined;

    const records = await prisma.physicalRecord.findMany({
      where: { cycleYear, ...(statusFilter ? { status: statusFilter } : {}) },
      include: { employee: true },
      orderBy: { createdAt: "asc" },
    });

    res.send(
      renderDashboardPage({
        hrUser: req.session.hrUser!,
        cycleYear,
        statusFilter,
        records: records.map((record) => ({
          id: record.id,
          employeeName: record.employee.fullName,
          employeeEmail: record.employee.email,
          status: record.status,
          sentAt: record.sentAt,
          receivedAt: record.receivedAt,
          completedAt: record.completedAt,
        })),
      })
    );
  });

  router.post("/records/:id/resend", requireHrAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      await resendLink(prisma, emailSender, req.params.id);
      const year = typeof req.query.year === "string" ? req.query.year : undefined;
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const params = new URLSearchParams();
      if (year) params.set("year", year);
      if (status) params.set("status", status);
      const qs = params.toString();
      res.redirect(303, `/dashboard${qs ? `?${qs}` : ""}`);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
