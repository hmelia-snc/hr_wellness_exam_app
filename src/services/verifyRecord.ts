import type { PrismaClient } from "@prisma/client";
import type { FormVerifier } from "../lib/verification/types.js";

/**
 * Runs OCR-based verification for a just-uploaded form and transitions the
 * record to `completed` or `needs_review` based on the result. Called
 * fire-and-forget from the upload route (real OCR calls take a few seconds —
 * the employee's request shouldn't wait on that), so failures are logged
 * here rather than thrown to a caller that's long gone.
 *
 * Guards against a race where the employee re-uploads a newer file while
 * this is still running: only applies the transition if `blobPath` still
 * matches the record's current uploadedBlobPath.
 */
export async function verifyPhysicalRecord(
  prisma: PrismaClient,
  formVerifier: FormVerifier,
  recordId: string,
  blobPath: string,
  buffer: Buffer,
  contentType: string
): Promise<void> {
  try {
    const result = await formVerifier.verify(buffer, contentType);

    const current = await prisma.physicalRecord.findUnique({ where: { id: recordId } });
    if (!current || current.uploadedBlobPath !== blobPath) {
      console.log(`[verifyPhysicalRecord] record ${recordId} superseded by a newer upload — skipping stale result.`);
      return;
    }

    await prisma.physicalRecord.update({
      where: { id: recordId },
      data: {
        status: result.passed ? "completed" : "needs_review",
        verificationResult: result.summary,
        completedAt: result.passed ? new Date() : null,
      },
    });
  } catch (err) {
    console.error(`[verifyPhysicalRecord] verification failed for record ${recordId}:`, err instanceof Error ? err.message : err);
  }
}
