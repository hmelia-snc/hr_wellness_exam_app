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
      tokenExpiresAt: tokenExpiryDate(new Date(), env.TOKEN_EXPIRY_DAYS),
      status: "sent",
    },
  });

  const link = `${env.APP_BASE_URL}/physical/${rawToken}`;
  try {
    await emailSender.send({
      toEmail: employee.email,
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

interface EmployeeRecord {
  id: string;
  fullName: string;
  email: string;
}
interface ResetRecordResult {
  rawToken: string;
  cycleYear: number;
  employee: EmployeeRecord;
}

/**
 * Shared by resendLink and generateShareableLink: regenerates a fresh token
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
      tokenExpiresAt: tokenExpiryDate(new Date(), env.TOKEN_EXPIRY_DAYS),
      status: "sent",
      sentAt: null,
      receivedAt: null,
      completedAt: null,
      uploadedFileUrl: null,
      uploadedBlobPath: null,
      uploadedContentType: null,
      verificationResult: null,
      reviewedBy: null,
      reviewedAt: null,
    },
  });

  return { rawToken, cycleYear: record.cycleYear, employee };
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

  const link = `${env.APP_BASE_URL}/physical/${rawToken}`;
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
  employeeEmail: string;
  cycleYear: number;
}

/**
 * Same reset as resendLink, but doesn't email anything — for HR to grab the
 * link directly from the dashboard (Slack, Teams, in person, etc.) instead
 * of waiting on email delivery. Still invalidates the previous token, same
 * as resendLink, since it's the same underlying reset.
 */
export async function generateShareableLink(
  prisma: PrismaClient,
  physicalRecordId: string
): Promise<ShareableLinkResult> {
  const env = getEnv();
  const { rawToken, cycleYear, employee } = await resetRecordWithFreshToken(prisma, physicalRecordId);
  return {
    link: `${env.APP_BASE_URL}/physical/${rawToken}`,
    employeeName: employee.fullName,
    employeeEmail: employee.email,
    cycleYear,
  };
}

/**
 * Full purge: deletes the employee, every physical_records row across all
 * cycle years, and any uploaded blobs (employee's and spouse's). Blob
 * deletion is best-effort — an orphaned blob is low-stakes, a delete stuck
 * behind a flaky storage call isn't, so failures are logged, not thrown.
 * Irreversible; the caller is responsible for confirming with the user.
 */
export async function deleteEmployee(prisma: PrismaClient, blobStorage: BlobStorage, employeeId: string): Promise<void> {
  const records = await prisma.physicalRecord.findMany({ where: { employeeId } });

  for (const record of records) {
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
  await prisma.employee.delete({ where: { id: employeeId } });
}
