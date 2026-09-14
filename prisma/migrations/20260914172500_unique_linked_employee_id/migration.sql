BEGIN TRY

BEGIN TRAN;

-- SQL Server's default unique constraint/index treats NULL as a normal
-- value and only allows ONE per column (unlike Postgres, where every NULL
-- is distinct). The very first migration made [email] UNIQUE while it was
-- still required, so it never hit this — but a later migration relaxed it
-- to nullable (for email-less spouse rows) without also switching the
-- constraint to a *filtered* unique index, so in practice only one
-- email-less row would have been allowed. Fixing that here alongside
-- adding the equivalent filtered index for linkedEmployeeId (same need:
-- every ordinary employee row has a NULL linkedEmployeeId, only spouse
-- rows have a real one, and those must stay unique per employee).

-- DropForeignKey
ALTER TABLE [dbo].[employees] DROP CONSTRAINT [employees_linkedEmployeeId_fkey];

-- DropIndex
ALTER TABLE [dbo].[employees] DROP CONSTRAINT [employees_email_key];

-- AlterTable
CREATE UNIQUE NONCLUSTERED INDEX [employees_email_key] ON [dbo].[employees]([email]) WHERE [email] IS NOT NULL;
CREATE UNIQUE NONCLUSTERED INDEX [employees_linkedEmployeeId_key] ON [dbo].[employees]([linkedEmployeeId]) WHERE [linkedEmployeeId] IS NOT NULL;

-- AddForeignKey
ALTER TABLE [dbo].[employees] ADD CONSTRAINT [employees_linkedEmployeeId_fkey] FOREIGN KEY ([linkedEmployeeId]) REFERENCES [dbo].[employees]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
