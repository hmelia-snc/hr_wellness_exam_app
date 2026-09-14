import type { PrismaClient } from "@prisma/client";
import { generateToken, tokenExpiryDate } from "../lib/token.js";
import type { EmailSender } from "../lib/email/types.js";
import type { BlobStorage } from "../lib/blobStorage.js";
import { getEnv } from "../config/env.js";

export interface UpsertEmployeeInput {
  fullName: string;
  email: string;
  employeeIdExternal?: string;
  cycleYear: number;
  // undefined = don't touch the existing value (e.g. a CSV re-import with no
  // needs_spouse_form column shouldn't clobber a value set later in the UI).
  needsSpouseForm?: boolean;
}

export interface UpsertEmployeeResult {
  employeeId: string;
  recordCreated: boolean;
  emailSent: boolean;
  emailError?: string;
}

/**
 * Upserts one employee by email and, unless a record already exists for the
 * given cycleYear, creates a fresh token + record and emails the link.
 * Shared by both the CSV bulk importer (importCycle.ts) and the dashboard's
 * single-employee "Add" action.
 */
export async function upsertEmployeeAndSendLink(
  prisma: PrismaClient,
  emailSender: EmailSender,
  input: UpsertEmployeeInput
): Promise<UpsertEmployeeResult> {
  const env = getEnv();

  const employee = await prisma.employee.upsert({
    where: { email: input.email },
    create: {
      email: input.email,
      fullName: input.fullName,
      employeeIdExternal: input.employeeIdExternal,
      active: true,
      ...(input.needsSpouseForm !== undefined ? { needsSpouseForm: input.needsSpouseForm } : {}),
    },
    update: {
      fullName: input.fullName,
      employeeIdExternal: input.employeeIdExternal,
      active: true,
      ...(input.needsSpouseForm !== undefined ? { needsSpouseForm: input.needsSpouseForm } : {}),
    },
  });

  // If this employee already has a linked spouse roster row (recordType
  // "spouse"), make sure it has a PhysicalRecord for this cycle too — e.g.
  // the spouse was linked after this employee's own record already existed
  // for an earlier cycle, or a re-run needs to catch it up. Idempotent, and
  // deliberately runs regardless of whether the employee's own record below
  // already exists for this cycle.
  const linkedSpouse = await prisma.employee.findFirst({ where: { recordType: "spouse", linkedEmployeeId: employee.id } });
  if (linkedSpouse) {
    await ensureSpousePhysicalRecordForCycle(prisma, linkedSpouse.id, input.cycleYear);
  }

  const existingRecord = await prisma.physicalRecord.findUnique({
    where: { employeeId_cycleYear: { employeeId: employee.id, cycleYear: input.cycleYear } },
  });

  if (existingRecord) {
    return { employeeId: employee.id, recordCreated: false, emailSent: false };
  }

  const { rawToken, tokenHash } = generateToken();
  const record = await prisma.physicalRecord.create({
    data: {
      employeeId: employee.id,
      cycleYear: input.cycleYear,
      tokenHash,
      rawToken,
      tokenExpiresAt: tokenExpiryDate(new Date(), env.TOKEN_EXPIRY_DAYS),
      status: "sent",
    },
  });

  const link = `${env.APP_BASE_URL}/wellness-exam/${rawToken}`;
  try {
    await emailSender.send({
      // input.email, not employee.email: this function is only ever for a
      // regular employee row (UpsertEmployeeInput.email is required), so
      // the value we just upserted with is guaranteed non-null — unlike
      // the roundtripped Employee.email column, which is nullable to allow
      // an email-less spouse row.
      toEmail: input.email,
      toName: employee.fullName,
      link,
      cycleYear: input.cycleYear,
    });
    await prisma.physicalRecord.update({ where: { id: record.id }, data: { sentAt: new Date() } });
    return { employeeId: employee.id, recordCreated: true, emailSent: true };
  } catch (err) {
    const emailError = err instanceof Error ? err.message : String(err);
    console.error(`[upsertEmployeeAndSendLink] email send failed for ${employee.email}:`, emailError);
    return { employeeId: employee.id, recordCreated: true, emailSent: false, emailError };
  }
}

export interface EnsureSpouseRecordResult {
  physicalRecordId: string;
  recordCreated: boolean;
}

/**
 * Idempotent get-or-create of a spouse's own PhysicalRecord for a cycle
 * year — the same "one record per employee per cycle" shape a regular
 * employee gets from upsertEmployeeAndSendLink, minus the email: the
 * spouse has no independent link/login of their own, so this just needs
 * *some* valid token to satisfy the schema (tokenHash is unique, non-null)
 * — it's never emailed or otherwise exposed. The spouse's actual upload
 * still comes in through the primary employee's own link (see
 * physical.ts), which resolves this record to write the file/status to.
 */
export async function ensureSpousePhysicalRecordForCycle(
  prisma: PrismaClient,
  spouseEmployeeId: string,
  cycleYear: number
): Promise<EnsureSpouseRecordResult> {
  const existing = await prisma.physicalRecord.findUnique({
    where: { employeeId_cycleYear: { employeeId: spouseEmployeeId, cycleYear } },
  });
  if (existing) {
    return { physicalRecordId: existing.id, recordCreated: false };
  }

  const env = getEnv();
  const { rawToken, tokenHash } = generateToken();
  const record = await prisma.physicalRecord.create({
    data: {
      employeeId: spouseEmployeeId,
      cycleYear,
      tokenHash,
      rawToken,
      tokenExpiresAt: tokenExpiryDate(new Date(), env.TOKEN_EXPIRY_DAYS),
      status: "sent",
      sentAt: new Date(),
    },
  });
  return { physicalRecordId: record.id, recordCreated: true };
}

export interface UpsertSpouseInput {
  fullName: string;
  email?: string;
  employeeIdExternal?: string;
  linkedEmployeeId: string;
  cycleYear: number;
}

export interface UpsertSpouseResult {
  employeeId: string;
  recordCreated: boolean;
}

/**
 * Creates or updates the spouse's own roster row (recordType "spouse",
 * linked back to the primary employee) and ensures its PhysicalRecord for
 * the given cycle year. Unlike upsertEmployeeAndSendLink, there's no email
 * to upsert by — a spouse row commonly has none — so the natural key is
 * "the one spouse row already linked to this employee" instead (enforced
 * by linkedEmployeeId being @unique in the schema, at most one per
 * employee).
 */
export async function upsertSpouseRecord(prisma: PrismaClient, input: UpsertSpouseInput): Promise<UpsertSpouseResult> {
  const existingSpouse = await prisma.employee.findUnique({ where: { linkedEmployeeId: input.linkedEmployeeId } });

  const employee = existingSpouse
    ? await prisma.employee.update({
        where: { id: existingSpouse.id },
        data: {
          fullName: input.fullName,
          email: input.email,
          employeeIdExternal: input.employeeIdExternal,
          active: true,
        },
      })
    : await prisma.employee.create({
        data: {
          fullName: input.fullName,
          email: input.email,
          employeeIdExternal: input.employeeIdExternal,
          active: true,
          recordType: "spouse",
          linkedEmployeeId: input.linkedEmployeeId,
        },
      });

  const { recordCreated } = await ensureSpousePhysicalRecordForCycle(prisma, employee.id, input.cycleYear);
  return { employeeId: employee.id, recordCreated };
}

interface EmployeeRecord {
  id: string;
  fullName: string;
  // Nullable: a spouse row (recordType "spouse") commonly has none, since
  // it never gets independent link/email delivery of its own.
  email: string | null;
}
interface ResetRecordResult {
  rawToken: string;
  cycleYear: number;
  employee: EmployeeRecord;
}

/**
 * Shared by resendLink and getShareableLink's regenerate-on-expiry path:
 * regenerates a fresh token
 * for an existing PhysicalRecord (invalidating the old one) and resets it to
 * a clean `sent` state — nothing uploaded yet, no email sent yet either
 * (callers decide separately whether to email it).
 */
async function resetRecordWithFreshToken(prisma: PrismaClient, physicalRecordId: string): Promise<ResetRecordResult> {
  const env = getEnv();
  const record = await prisma.physicalRecord.findUnique({ where: { id: physicalRecordId } });
  if (!record) {
    throw new Error(`No physical record found with id ${physicalRecordId}`);
  }
  const employee = await prisma.employee.findUnique({ where: { id: record.employeeId } });
  if (!employee) {
    throw new Error(`No employee found with id ${record.employeeId}`);
  }

  const { rawToken, tokenHash } = generateToken();
  await prisma.physicalRecord.update({
    where: { id: physicalRecordId },
    data: {
      tokenHash,
      rawToken,
      tokenExpiresAt: tokenExpiryDate(new Date(), env.TOKEN_EXPIRY_DAYS),
      status: "sent",
      sentAt: null,
      receivedAt: null,
      completedAt: null,
      uploadedFileUrl: null,
      uploadedBlobPath: null,
      uploadedContentType: null,
      verificationResult: null,
      rejectionReason: null,
      reviewedBy: null,
      reviewedAt: null,
    },
  });

  return { rawToken, cycleYear: record.cycleYear, employee };
}

/**
 * Manually marks a record `completed` — the same transition the OCR pass
 * applies automatically, just triggered by HR instead. Shared by the
 * single-record and bulk "Approve" actions. This is specifically the
 * employee's own upload; see approveSpouseForm for the spouse's, tracked
 * independently since the two are reviewed separately.
 */
export async function approveRecord(prisma: PrismaClient, physicalRecordId: string, reviewedBy: string): Promise<void> {
  await prisma.physicalRecord.update({
    where: { id: physicalRecordId },
    data: {
      status: "completed",
      completedAt: new Date(),
      reviewedBy,
      reviewedAt: new Date(),
      verificationResult: `Manually approved by ${reviewedBy}.`,
    },
  });
}

/**
 * Same as approveRecord, but for the spouse's upload — tracked in its own
 * set of fields (spouseStatus/spouseCompletedAt/etc.) since HR reviews each
 * side of the form independently. No OCR ever runs on the spouse's upload,
 * so this manual approval is the only way it ever reaches "completed".
 */
export async function approveSpouseForm(prisma: PrismaClient, physicalRecordId: string, reviewedBy: string): Promise<void> {
  await prisma.physicalRecord.update({
    where: { id: physicalRecordId },
    data: {
      spouseStatus: "completed",
      spouseCompletedAt: new Date(),
      spouseReviewedBy: reviewedBy,
      spouseReviewedAt: new Date(),
      spouseVerificationResult: `Manually approved by ${reviewedBy}.`,
    },
  });
}

export interface ResendLinkResult {
  emailSent: boolean;
  emailError?: string;
}

/**
 * Regenerates a fresh token for an existing PhysicalRecord (invalidating the
 * old one), resets it to a clean `sent` state, and re-sends the email.
 * Available regardless of current status: covers a lost/expired link, and
 * also doubles as "force a re-upload" for a needs_review case.
 */
export async function resendLink(
  prisma: PrismaClient,
  emailSender: EmailSender,
  physicalRecordId: string
): Promise<ResendLinkResult> {
  const env = getEnv();
  const { rawToken, cycleYear, employee } = await resetRecordWithFreshToken(prisma, physicalRecordId);

  if (!employee.email) {
    return { emailSent: false, emailError: "No email on file for this record." };
  }

  const link = `${env.APP_BASE_URL}/wellness-exam/${rawToken}`;
  try {
    await emailSender.send({ toEmail: employee.email, toName: employee.fullName, link, cycleYear });
    await prisma.physicalRecord.update({ where: { id: physicalRecordId }, data: { sentAt: new Date() } });
    return { emailSent: true };
  } catch (err) {
    const emailError = err instanceof Error ? err.message : String(err);
    console.error(`[resendLink] email send failed for record ${physicalRecordId} (${employee.email}):`, emailError);
    return { emailSent: false, emailError };
  }
}

export interface ShareableLinkResult {
  link: string;
  employeeName: string;
  // Nullable: a spouse row (recordType "spouse") commonly has none.
  employeeEmail: string | null;
  cycleYear: number;
  // True only when there was no usable existing token (none stored yet, or
  // it had expired) and a fresh one had to be generated — in which case any
  // link previously sent to the employee no longer works. False is the
  // common case: the employee's existing link is simply being shown again.
  regenerated: boolean;
}

/**
 * Returns the employee's current upload link for HR to grab from the
 * dashboard (Slack, Teams, in person, etc.) — without regenerating it, so
 * whatever link was already emailed to the employee keeps working. Only
 * falls back to generating (and thereby invalidating) a fresh token when
 * there's no usable one already: either none stored (a record created
 * before `rawToken` existed), or the stored one has expired.
 */
export async function getShareableLink(prisma: PrismaClient, physicalRecordId: string): Promise<ShareableLinkResult> {
  const env = getEnv();
  const record = await prisma.physicalRecord.findUnique({ where: { id: physicalRecordId } });
  if (!record) {
    throw new Error(`No physical record found with id ${physicalRecordId}`);
  }
  const employee = await prisma.employee.findUnique({ where: { id: record.employeeId } });
  if (!employee) {
    throw new Error(`No employee found with id ${record.employeeId}`);
  }

  if (record.rawToken && record.tokenExpiresAt.getTime() >= Date.now()) {
    return {
      link: `${env.APP_BASE_URL}/wellness-exam/${record.rawToken}`,
      employeeName: employee.fullName,
      employeeEmail: employee.email,
      cycleYear: record.cycleYear,
      regenerated: false,
    };
  }

  const reset = await resetRecordWithFreshToken(prisma, physicalRecordId);
  return {
    link: `${env.APP_BASE_URL}/wellness-exam/${reset.rawToken}`,
    employeeName: reset.employee.fullName,
    employeeEmail: reset.employee.email,
    cycleYear: reset.cycleYear,
    regenerated: true,
  };
}

export interface RejectRecordResult {
  emailSent: boolean;
  emailError?: string;
}

/**
 * Marks a record `rejected` with a reason and emails the employee. Clears
 * receivedAt/completedAt so status/progress correctly show "not yet
 * received" until a corrected form comes in — but deliberately leaves the
 * uploaded file/blob alone so HR can still pull up what was rejected via
 * "View file". Reuses the employee's existing link rather than invalidating
 * it (same as getShareableLink), so they can fix and resubmit with the link
 * they already have — only falls back to a fresh token if theirs expired.
 * This is specifically the employee's own upload; see rejectSpouseForm for
 * the spouse's, tracked independently since the two are reviewed
 * separately.
 */
export async function rejectRecord(
  prisma: PrismaClient,
  emailSender: EmailSender,
  physicalRecordId: string,
  reason: string,
  reviewedBy: string
): Promise<RejectRecordResult> {
  const linkResult = await getShareableLink(prisma, physicalRecordId);

  await prisma.physicalRecord.update({
    where: { id: physicalRecordId },
    data: {
      status: "rejected",
      rejectionReason: reason,
      receivedAt: null,
      completedAt: null,
      reviewedBy,
      reviewedAt: new Date(),
    },
  });

  if (!linkResult.employeeEmail) {
    return { emailSent: false, emailError: "No email on file for this record." };
  }

  try {
    await emailSender.sendRejection({
      toEmail: linkResult.employeeEmail,
      toName: linkResult.employeeName,
      cycleYear: linkResult.cycleYear,
      reason,
      link: linkResult.link,
      submitterRole: "employee",
    });
    return { emailSent: true };
  } catch (err) {
    const emailError = err instanceof Error ? err.message : String(err);
    console.error(`[rejectRecord] email send failed for record ${physicalRecordId} (${linkResult.employeeEmail}):`, emailError);
    return { emailSent: false, emailError };
  }
}

/**
 * Same as rejectRecord, but for the spouse's upload: marks spouseStatus
 * `rejected`, clears spouseReceivedAt/spouseCompletedAt (leaving the
 * uploaded blob alone so HR can still view what was rejected), and emails
 * the employee — the spouse has no separate email/link of their own, so the
 * same "your spouse's form" email goes to the employee's address, with
 * their shared existing link to resubmit through.
 */
export async function rejectSpouseForm(
  prisma: PrismaClient,
  emailSender: EmailSender,
  physicalRecordId: string,
  reason: string,
  reviewedBy: string
): Promise<RejectRecordResult> {
  const linkResult = await getShareableLink(prisma, physicalRecordId);

  await prisma.physicalRecord.update({
    where: { id: physicalRecordId },
    data: {
      spouseStatus: "rejected",
      spouseRejectionReason: reason,
      spouseReceivedAt: null,
      spouseCompletedAt: null,
      spouseReviewedBy: reviewedBy,
      spouseReviewedAt: new Date(),
    },
  });

  if (!linkResult.employeeEmail) {
    return { emailSent: false, emailError: "No email on file for this record." };
  }

  try {
    await emailSender.sendRejection({
      toEmail: linkResult.employeeEmail,
      toName: linkResult.employeeName,
      cycleYear: linkResult.cycleYear,
      reason,
      link: linkResult.link,
      submitterRole: "spouse",
    });
    return { emailSent: true };
  } catch (err) {
    const emailError = err instanceof Error ? err.message : String(err);
    console.error(`[rejectSpouseForm] email send failed for record ${physicalRecordId} (${linkResult.employeeEmail}):`, emailError);
    return { emailSent: false, emailError };
  }
}

/** Deletes one employee's own records/blobs (not the Employee row itself) — shared by deleteEmployee below. */
async function purgeRecordsAndBlobs(prisma: PrismaClient, blobStorage: BlobStorage, employeeId: string): Promise<void> {
  const records = await prisma.physicalRecord.findMany({ where: { employeeId } });

  for (const record of records) {
    // spouseUploadedBlobPath is only ever populated under the older,
    // pre-record-type model (spouse upload embedded on the employee's own
    // record) — a linked spouse row (recordType "spouse") has its own
    // PhysicalRecord, purged via its own pass through this same function.
    for (const blobPath of [record.uploadedBlobPath, record.spouseUploadedBlobPath]) {
      if (!blobPath) continue;
      try {
        await blobStorage.deleteForm(blobPath);
      } catch (err) {
        console.error(`[deleteEmployee] failed to delete blob ${blobPath}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  await prisma.physicalRecord.deleteMany({ where: { employeeId } });
}

/**
 * Full purge: deletes the employee, every physical_records row across all
 * cycle years, and any uploaded blobs (employee's and spouse's, under the
 * older embedded-spouse model). Blob deletion is best-effort — an orphaned
 * blob is low-stakes, a delete stuck behind a flaky storage call isn't, so
 * failures are logged, not thrown. Irreversible; the caller is responsible
 * for confirming with the user.
 *
 * If this employee has a linked spouse roster row (recordType "spouse"),
 * that gets fully purged too — deleting the "family unit" together rather
 * than leaving an orphaned spouse row pointing at a now-gone employee.
 * Deleting a spouse row directly (not its primary) just purges that one
 * row, unchanged.
 */
export async function deleteEmployee(prisma: PrismaClient, blobStorage: BlobStorage, employeeId: string): Promise<void> {
  const linkedSpouse = await prisma.employee.findFirst({ where: { recordType: "spouse", linkedEmployeeId: employeeId } });
  if (linkedSpouse) {
    await purgeRecordsAndBlobs(prisma, blobStorage, linkedSpouse.id);
    await prisma.employee.delete({ where: { id: linkedSpouse.id } });
  }

  await purgeRecordsAndBlobs(prisma, blobStorage, employeeId);
  await prisma.employee.delete({ where: { id: employeeId } });
}
