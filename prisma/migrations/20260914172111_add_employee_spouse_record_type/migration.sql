BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[employees] ALTER COLUMN [email] NVARCHAR(1000) NULL;
ALTER TABLE [dbo].[employees] ADD [linkedEmployeeId] NVARCHAR(1000),
[recordType] NVARCHAR(1000) NOT NULL CONSTRAINT [employees_recordType_df] DEFAULT 'employee';

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
