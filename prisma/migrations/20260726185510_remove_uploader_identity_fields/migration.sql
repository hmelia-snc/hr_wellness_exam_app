/*
  Warnings:

  - You are about to drop the column `uploaderEmail` on the `physical_records` table. All the data in the column will be lost.
  - You are about to drop the column `uploaderFirstName` on the `physical_records` table. All the data in the column will be lost.
  - You are about to drop the column `uploaderLastName` on the `physical_records` table. All the data in the column will be lost.

*/
BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[physical_records] DROP COLUMN [uploaderEmail],
[uploaderFirstName],
[uploaderLastName];

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
