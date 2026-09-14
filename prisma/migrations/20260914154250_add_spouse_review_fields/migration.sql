BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[physical_records] ADD [spouseCompletedAt] DATETIME2,
[spouseRejectionReason] NVARCHAR(1000),
[spouseReviewedAt] DATETIME2,
[spouseReviewedBy] NVARCHAR(1000),
[spouseStatus] NVARCHAR(1000),
[spouseVerificationResult] NVARCHAR(1000);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
