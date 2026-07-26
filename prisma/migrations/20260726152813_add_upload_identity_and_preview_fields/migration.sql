BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[physical_records] ADD [uploadedBlobPath] NVARCHAR(1000),
[uploadedContentType] NVARCHAR(1000),
[uploaderEmail] NVARCHAR(1000),
[uploaderFirstName] NVARCHAR(1000),
[uploaderLastName] NVARCHAR(1000);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
