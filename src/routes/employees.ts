import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import type { PrismaClient } from "@prisma/client";
import { requireHrAuth } from "../lib/auth.js";
import type { EmailSender } from "../lib/email/types.js";
import type { BlobStorage } from "../lib/blobStorage.js";
import { upsertEmployeeAndSendLink, deleteEmployee } from "../services/employeeActions.js";
import { importCycle } from "../services/importCycle.js";
import { renderEmployeesPage } from "../views/employeesPage.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function toEmployeeRows(
  employees: { id: string; fullName: string; email: string; employeeIdExternal: string | null; active: boolean; needsSpouseForm: boolean }[]
) {
  return employees.map((e) => ({
    id: e.id,
    fullName: e.fullName,
    email: e.email,
    employeeIdExternal: e.employeeIdExternal,
    active: e.active,
    needsSpouseForm: e.needsSpouseForm,
  }));
}

export function createEmployeesRouter(prisma: PrismaClient, emailSender: EmailSender, blobStorage: BlobStorage): Router {
  const router = Router();

  router.get("/", requireHrAuth, async (req: Request, res: Response) => {
    const employees = await prisma.employee.findMany({ orderBy: { fullName: "asc" } });
    const addResult =
      req.query.added === "added" || req.query.added === "exists" || req.query.added === "added_email_failed"
        ? req.query.added
        : undefined;
    res.send(
      renderEmployeesPage({
        hrUser: req.session.hrUser!,
        defaultCycleYear: new Date().getFullYear(),
        employees: toEmployeeRows(employees),
        addResult,
        deleted: req.query.deleted === "1",
      })
    );
  });

  router.get("/csv-template", requireHrAuth, (_req: Request, res: Response) => {
    const template =
      "full_name,email,employee_id_external,needs_spouse_form\n" +
      "Jane Doe,jane.doe@example.com,E12345,yes\n" +
      "John Smith,john.smith@example.com,E12346,no\n";
    res.type("text/csv").attachment("employee-roster-template.csv").send(template);
  });

  router.post("/", requireHrAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { fullName, email, employeeIdExternal, cycleYear, needsSpouseForm } = req.body ?? {};
      if (!fullName || !email || !cycleYear) {
        res.status(400).send("fullName, email, and cycleYear are required.");
        return;
      }
      const result = await upsertEmployeeAndSendLink(prisma, emailSender, {
        fullName,
        email,
        employeeIdExternal: employeeIdExternal || undefined,
        cycleYear: Number(cycleYear),
        needsSpouseForm: Boolean(needsSpouseForm),
      });
      const added = !result.recordCreated ? "exists" : result.emailSent ? "added" : "added_email_failed";
      res.redirect(303, `/dashboard/employees?added=${added}`);
    } catch (err) {
      next(err);
    }
  });

  router.post("/import", requireHrAuth, upload.single("csv"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) {
        res.status(400).send("No CSV file uploaded.");
        return;
      }
      const cycleYear = Number(req.body?.cycleYear);
      if (!cycleYear) {
        res.status(400).send("cycleYear is required.");
        return;
      }
      const csvContent = req.file.buffer.toString("utf-8");
      const result = await importCycle(prisma, emailSender, {
        csvContent,
        cycleYear,
        uploadedBy: req.session.hrUser!.email,
      });

      const employees = await prisma.employee.findMany({ orderBy: { fullName: "asc" } });
      res.send(
        renderEmployeesPage({
          hrUser: req.session.hrUser!,
          defaultCycleYear: cycleYear,
          employees: toEmployeeRows(employees),
          importResult: result,
        })
      );
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/deactivate", requireHrAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      await prisma.employee.update({ where: { id: req.params.id }, data: { active: false } });
      res.redirect(303, "/dashboard/employees");
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/reactivate", requireHrAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      await prisma.employee.update({ where: { id: req.params.id }, data: { active: true } });
      res.redirect(303, "/dashboard/employees");
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/toggle-spouse-form", requireHrAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const employee = await prisma.employee.findUnique({ where: { id: req.params.id } });
      if (!employee) {
        res.status(404).send("Employee not found.");
        return;
      }
      await prisma.employee.update({ where: { id: req.params.id }, data: { needsSpouseForm: !employee.needsSpouseForm } });
      res.redirect(303, "/dashboard/employees");
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/delete", requireHrAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      await deleteEmployee(prisma, blobStorage, req.params.id);
      res.redirect(303, "/dashboard/employees?deleted=1");
    } catch (err) {
      next(err);
    }
  });

  return router;
}
