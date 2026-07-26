BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[employees] (
    [id] NVARCHAR(1000) NOT NULL,
    [fullName] NVARCHAR(1000) NOT NULL,
    [email] NVARCHAR(1000) NOT NULL,
    [employeeIdExternal] NVARCHAR(1000),
    [active] BIT NOT NULL CONSTRAINT [employees_active_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [employees_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [employees_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [employees_email_key] UNIQUE NONCLUSTERED ([email])
);

-- CreateTable
CREATE TABLE [dbo].[physical_records] (
    [id] NVARCHAR(1000) NOT NULL,
    [employeeId] NVARCHAR(1000) NOT NULL,
    [cycleYear] INT NOT NULL,
    [tokenHash] NVARCHAR(1000) NOT NULL,
    [tokenExpiresAt] DATETIME2 NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [physical_records_status_df] DEFAULT 'sent',
    [sentAt] DATETIME2,
    [receivedAt] DATETIME2,
    [completedAt] DATETIME2,
    [uploadedFileUrl] NVARCHAR(1000),
    [verificationResult] NVARCHAR(1000),
    [reviewedBy] NVARCHAR(1000),
    [reviewedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [physical_records_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [physical_records_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [physical_records_tokenHash_key] UNIQUE NONCLUSTERED ([tokenHash]),
    CONSTRAINT [physical_records_employeeId_cycleYear_key] UNIQUE NONCLUSTERED ([employeeId],[cycleYear])
);

-- CreateTable
CREATE TABLE [dbo].[upload_batches] (
    [id] NVARCHAR(1000) NOT NULL,
    [uploadedBy] NVARCHAR(1000) NOT NULL,
    [uploadedAt] DATETIME2 NOT NULL CONSTRAINT [upload_batches_uploadedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [rowCount] INT NOT NULL,
    CONSTRAINT [upload_batches_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- AddForeignKey
ALTER TABLE [dbo].[physical_records] ADD CONSTRAINT [physical_records_employeeId_fkey] FOREIGN KEY ([employeeId]) REFERENCES [dbo].[employees]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
