import type { FormVerifier, VerificationResult } from "./types.js";

/** Local-dev stand-in for the Azure verifier: always passes, logs instead of calling out. */
export class MockFormVerifier implements FormVerifier {
  async verify(buffer: Buffer, contentType: string): Promise<VerificationResult> {
    console.log(`[mock-verification] Skipping real OCR — auto-passing ${buffer.length}-byte ${contentType} upload.`);
    return { passed: true, summary: "Mock verification (VERIFICATION_MODE=mock): auto-passed, no real OCR ran." };
  }
}
