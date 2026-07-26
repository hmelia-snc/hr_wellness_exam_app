BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[employees] ADD [needsSpouseForm] BIT NOT NULL CONSTRAINT [employees_needsSpouseForm_df] DEFAULT 0;

-- AlterTable
ALTER TABLE [dbo].[physical_records] ADD [spouseReceivedAt] DATETIME2,
[spouseUploadedBlobPath] NVARCHAR(1000),
[spouseUploadedContentType] NVARCHAR(1000),
[spouseUploadedFileUrl] NVARCHAR(1000);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
