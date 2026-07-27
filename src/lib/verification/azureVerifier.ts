import { DocumentAnalysisClient, AzureKeyCredential } from "@azure/ai-form-recognizer";
import type { FormVerifier, VerificationResult } from "./types.js";
import type { Env } from "../../config/env.js";

// v1 scope is presence checks only (not per-field extraction): confirm the
// upload isn't a blank/corrupt scan, and that it looks hand-signed rather
// than an untouched blank template. Both are heuristics — false positives
// and negatives are expected and land in `needs_review` for HR to resolve.
const MIN_TEXT_LENGTH = 40;
const HANDWRITING_CONFIDENCE_THRESHOLD = 0.5;

/**
 * Runs the uploaded form through Azure AI Document Intelligence's prebuilt
 * "read" model (OCR) and applies presence-check heuristics. Does not
 * validate specific fields (name, date, etc.) — see the plan notes for why
 * that was deferred out of v1 scope.
 */
export class AzureDocumentIntelligenceVerifier implements FormVerifier {
  private client: DocumentAnalysisClient;

  constructor(env: Pick<Env, "DOCUMENT_INTELLIGENCE_ENDPOINT" | "DOCUMENT_INTELLIGENCE_KEY">) {
    this.client = new DocumentAnalysisClient(
      env.DOCUMENT_INTELLIGENCE_ENDPOINT!,
      new AzureKeyCredential(env.DOCUMENT_INTELLIGENCE_KEY!)
    );
  }

  async verify(buffer: Buffer, _contentType: string): Promise<VerificationResult> {
    const poller = await this.client.beginAnalyzeDocument("prebuilt-read", buffer);
    const result = await poller.pollUntilDone();

    const content = (result.content ?? "").trim();
    if (content.length < MIN_TEXT_LENGTH) {
      return { passed: false, summary: "Document appears blank or unreadable — needs manual review." };
    }

    const hasHandwriting = (result.styles ?? []).some(
      (style) => style.isHandwritten && style.confidence >= HANDWRITING_CONFIDENCE_THRESHOLD
    );
    if (!hasHandwriting) {
      return {
        passed: false,
        summary: "No handwritten signature detected — this may be an unsigned blank form. Needs manual review.",
      };
    }

    return { passed: true, summary: "Document contains readable text and a handwritten signature." };
  }
}
