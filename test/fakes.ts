import type { BlobStorage } from "../src/lib/blobStorage.js";
import type { EmailSender, PhysicalFormEmail } from "../src/lib/email/types.js";

export function createFakeBlobStorage(): BlobStorage & {
  uploads: { blobPath: string; contentType: string; buffer: Buffer }[];
} {
  const uploads: { blobPath: string; contentType: string; buffer: Buffer }[] = [];
  return {
    uploads,
    async uploadForm(buffer, blobPath, contentType) {
      uploads.push({ blobPath, contentType, buffer });
      return `https://fake-blob.test/${blobPath}`;
    },
    async downloadForm(blobPath) {
      const match = uploads.find((u) => u.blobPath === blobPath);
      if (!match) throw new Error(`no such blob: ${blobPath}`);
      return match.buffer;
    },
  };
}

export interface FakeEmailSenderOptions {
  failFor?: Set<string>;
}

export function createFakeEmailSender(options: FakeEmailSenderOptions = {}): EmailSender & { sent: PhysicalFormEmail[] } {
  const sent: PhysicalFormEmail[] = [];
  return {
    sent,
    async send(email) {
      if (options.failFor?.has(email.toEmail)) {
        throw new Error("simulated send failure");
      }
      sent.push(email);
    },
  };
}
