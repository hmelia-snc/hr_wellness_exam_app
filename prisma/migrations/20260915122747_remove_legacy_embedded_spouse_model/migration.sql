BEGIN TRY

BEGIN TRAN;

-- No live data yet, so this drops rather than deprecates: removes the
-- pre-record-type-split "embedded spouse" model entirely — the
-- needsSpouseForm flag and the spouse* fields on physical_records that
-- tracked a spouse's upload as extra columns on the employee's own record,
-- superseded by a spouse's own linked Employee row + PhysicalRecord.

-- DropDefaultConstraint (needsSpouseForm has a default, unlike the
-- physical_records spouse* columns below, which are all plain nullable
-- columns with no default constraint to drop first)
ALTER TABLE [dbo].[employees] DROP CONSTRAINT [employees_needsSpouseForm_df];

-- AlterTable
ALTER TABLE [dbo].[employees] DROP COLUMN [needsSpouseForm];

-- AlterTable
ALTER TABLE [dbo].[physical_records] DROP COLUMN
  [spouseCompletedAt],
  [spouseReceivedAt],
  [spouseRejectionReason],
  [spouseReviewedAt],
  [spouseReviewedBy],
  [spouseStatus],
  [spouseUploadedBlobPath],
  [spouseUploadedContentType],
  [spouseUploadedFileUrl],
  [spouseVerificationResult];

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
