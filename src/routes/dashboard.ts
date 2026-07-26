import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { requireHrAuth } from "../lib/auth.js";
import { renderDashboardPage } from "../views/dashboardPage.js";

export function createDashboardRouter(prisma: PrismaClient): Router {
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

  return router;
}
