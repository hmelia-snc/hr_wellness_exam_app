import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import type { PrismaClient } from "@prisma/client";
import { requireHrAuth } from "../lib/auth.js";
import type { EmailSender } from "../lib/email/types.js";
import type { BlobStorage } from "../lib/blobStorage.js";
import { upsertEmployeeAndSendLink, upsertSpouseRecord, deleteEmployee } from "../services/employeeActions.js";
import { importCycle } from "../services/importCycle.js";
import { renderEmployeesPage, type EmployeeRow } from "../views/employeesPage.js";
import { toIdArray } from "../lib/requestArrays.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

type RosterRow = {
  id: string;
  fullName: string;
  email: string | null;
  employeeIdExternal: string | null;
  active: boolean;
  recordType: string;
  linkedEmployee: { fullName: string } | null;
  spouseRecords: { id: string; fullName: string }[];
};

function toEmployeeRows(employees: RosterRow[]): EmployeeRow[] {
  return employees.map((e) => ({
    id: e.id,
    fullName: e.fullName,
    email: e.email,
    employeeIdExternal: e.employeeIdExternal,
    active: e.active,
    recordType: e.recordType === "spouse" ? "spouse" : "employee",
    linkedEmployeeName: e.linkedEmployee?.fullName ?? null,
    spouseName: e.spouseRecords[0]?.fullName ?? null,
  }));
}

/** Options for the "associate with employee" selector when adding a spouse. */
async function activeEmployeeOptions(prisma: PrismaClient): Promise<{ id: string; fullName: string }[]> {
  const employees = await prisma.employee.findMany({
    where: { recordType: "employee", active: true },
    select: { id: true, fullName: true },
    orderBy: { fullName: "asc" },
  });
  return employees;
}

export function createEmployeesRouter(prisma: PrismaClient, emailSender: EmailSender, blobStorage: BlobStorage): Router {
  const router = Router();

  router.get("/", requireHrAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const employees = await prisma.employee.findMany({
        orderBy: { fullName: "asc" },
        include: { linkedEmployee: { select: { fullName: true } }, spouseRecords: { select: { id: true, fullName: true } } },
      });
      const addResult =
        req.query.added === "added" || req.query.added === "exists" || req.query.added === "added_email_failed"
          ? req.query.added
          : undefined;
      res.send(
        renderEmployeesPage({
          hrUser: req.session.hrUser!,
          defaultCycleYear: new Date().getFullYear(),
          employees: toEmployeeRows(employees),
          employeeOptions: await activeEmployeeOptions(prisma),
          addResult,
          deleted: req.query.deleted === "1",
          bulkDeleted: typeof req.query.bulkDeleted === "string" ? Number(req.query.bulkDeleted) || undefined : undefined,
        })
      );
    } catch (err) {
      next(err);
    }
  });

  router.get("/csv-template", requireHrAuth, (_req: Request, res: Response) => {
    const template =
      "record_type,full_name,email,employee_id_external\n" +
      "employee,Jane Doe,jane.doe@example.com,E12345\n" +
      "spouse,John Doe,,E12345\n" +
      "employee,John Smith,john.smith@example.com,E12346\n";
    res.type("text/csv").attachment("employee-roster-template.csv").send(template);
  });

  router.post("/", requireHrAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { recordType, fullName, email, employeeIdExternal, cycleYear, linkedEmployeeId } = req.body ?? {};
      if (!fullName || !cycleYear) {
        res.status(400).send("fullName and cycleYear are required.");
        return;
      }

      if (recordType === "spouse") {
        if (!linkedEmployeeId) {
          res.status(400).send("Select which employee this spouse belongs to.");
          return;
        }
        await upsertSpouseRecord(prisma, {
          fullName,
          email: email || undefined,
          employeeIdExternal: employeeIdExternal || undefined,
          linkedEmployeeId,
          cycleYear: Number(cycleYear),
        });
        res.redirect(303, "/dashboard/employees?added=added");
        return;
      }

      if (!email) {
        res.status(400).send("email is required for an employee record.");
        return;
      }
      const result = await upsertEmployeeAndSendLink(prisma, emailSender, {
        fullName,
        email,
        employeeIdExternal: employeeIdExternal || undefined,
        cycleYear: Number(cycleYear),
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

      const employees = await prisma.employee.findMany({
        orderBy: { fullName: "asc" },
        include: { linkedEmployee: { select: { fullName: true } }, spouseRecords: { select: { id: true, fullName: true } } },
      });
      res.send(
        renderEmployeesPage({
          hrUser: req.session.hrUser!,
          defaultCycleYear: cycleYear,
          employees: toEmployeeRows(employees),
          employeeOptions: await activeEmployeeOptions(prisma),
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

  router.post("/:id/delete", requireHrAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      await deleteEmployee(prisma, blobStorage, req.params.id);
      res.redirect(303, "/dashboard/employees?deleted=1");
    } catch (err) {
      next(err);
    }
  });

  router.post("/bulk-delete", requireHrAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ids = toIdArray(req.body?.ids);
      for (const id of ids) {
        await deleteEmployee(prisma, blobStorage, id);
      }
      res.redirect(303, `/dashboard/employees?bulkDeleted=${ids.length}`);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
