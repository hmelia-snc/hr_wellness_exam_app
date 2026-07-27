import type { BlobStorage } from "../src/lib/blobStorage.js";
import type { EmailSender, PhysicalFormEmail, UploadConfirmationEmail } from "../src/lib/email/types.js";
import type { FormVerifier, VerificationResult } from "../src/lib/verification/types.js";

export function createFakeBlobStorage(): BlobStorage & {
  uploads: { blobPath: string; contentType: string; buffer: Buffer }[];
  deleted: string[];
} {
  const uploads: { blobPath: string; contentType: string; buffer: Buffer }[] = [];
  const deleted: string[] = [];
  return {
    uploads,
    deleted,
    async uploadForm(buffer, blobPath, contentType) {
      uploads.push({ blobPath, contentType, buffer });
      return `https://fake-blob.test/${blobPath}`;
    },
    async downloadForm(blobPath) {
      const match = uploads.find((u) => u.blobPath === blobPath);
      if (!match) throw new Error(`no such blob: ${blobPath}`);
      return match.buffer;
    },
    async deleteForm(blobPath) {
      deleted.push(blobPath);
    },
  };
}

export interface FakeFormVerifierOptions {
  result?: VerificationResult;
}

export function createFakeFormVerifier(
  options: FakeFormVerifierOptions = {}
): FormVerifier & { calls: { buffer: Buffer; contentType: string }[] } {
  const calls: { buffer: Buffer; contentType: string }[] = [];
  const result = options.result ?? { passed: true, summary: "fake verifier: passed" };
  return {
    calls,
    async verify(buffer, contentType) {
      calls.push({ buffer, contentType });
      return result;
    },
  };
}

export interface FakeEmailSenderOptions {
  failFor?: Set<string>;
}

export function createFakeEmailSender(
  options: FakeEmailSenderOptions = {}
): EmailSender & { sent: PhysicalFormEmail[]; confirmationsSent: UploadConfirmationEmail[] } {
  const sent: PhysicalFormEmail[] = [];
  const confirmationsSent: UploadConfirmationEmail[] = [];
  return {
    sent,
    confirmationsSent,
    async send(email) {
      if (options.failFor?.has(email.toEmail)) {
        throw new Error("simulated send failure");
      }
      sent.push(email);
    },
    async sendUploadConfirmation(email) {
      if (options.failFor?.has(email.toEmail)) {
        throw new Error("simulated send failure");
      }
      confirmationsSent.push(email);
    },
  };
}
