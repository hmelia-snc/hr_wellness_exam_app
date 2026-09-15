BEGIN TRY

BEGIN TRAN;

-- A spouse row (recordType='spouse') commonly shares its linked employee's
-- email (a household inbox) — that's expected, not a conflict, since a
-- spouse never gets independent link/email delivery of its own. The
-- existing filtered unique index on [email] only excluded NULLs, so a
-- shared non-null email between an employee and its spouse (or between two
-- spouses) hit the unique constraint. Re-scope the filter to recordType =
-- 'employee' as well, so uniqueness is only enforced among real employee
-- rows.

-- DropIndex
DROP INDEX [employees_email_key] ON [dbo].[employees];

-- AlterTable
CREATE UNIQUE NONCLUSTERED INDEX [employees_email_key] ON [dbo].[employees]([email]) WHERE [email] IS NOT NULL AND [recordType] = 'employee';

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
