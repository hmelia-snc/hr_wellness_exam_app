import type { PrismaClient } from "@prisma/client";
import { generateToken, tokenExpiryDate } from "../lib/token.js";
import type { EmailSender } from "../lib/email/types.js";
import { getEnv } from "../config/env.js";

export interface UpsertEmployeeInput {
  fullName: string;
  email: string;
  employeeIdExternal?: string;
  cycleYear: number;
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
    },
    update: {
      fullName: input.fullName,
      employeeIdExternal: input.employeeIdExternal,
      active: true,
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
    return {
      employeeId: employee.id,
      recordCreated: true,
      emailSent: false,
      emailError: err instanceof Error ? err.message : String(err),
    };
  }
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

  const link = `${env.APP_BASE_URL}/physical/${rawToken}`;
  try {
    await emailSender.send({
      toEmail: employee.email,
      toName: employee.fullName,
      link,
      cycleYear: record.cycleYear,
    });
    await prisma.physicalRecord.update({ where: { id: physicalRecordId }, data: { sentAt: new Date() } });
    return { emailSent: true };
  } catch (err) {
    return { emailSent: false, emailError: err instanceof Error ? err.message : String(err) };
  }
}
