import { DocumentAnalysisClient, AzureKeyCredential } from "@azure/ai-form-recognizer";
import type { FormVerifier, VerificationResult } from "./types.js";
import type { Env } from "../../config/env.js";

const MIN_TEXT_LENGTH = 40;
const HANDWRITING_CONFIDENCE_THRESHOLD = 0.5;
// Per a real Document Intelligence smoke test against the blank template, a
// stray "1" and "/" from the unfilled date field's underscore/slash
// placeholder both got misclassified as handwritten (confidence 0.6-0.7) —
// noise, not a signature. A genuine signature is virtually always more than
// a couple characters, so requiring a single contiguous handwritten span of
// at least this length filters that out without needing a much higher (and
// more failure-prone) confidence bar.
const MIN_HANDWRITTEN_SPAN_LENGTH = 3;

// Case-insensitive substrings expected somewhere on a genuine Wellness Exam
// Verification Form — pulled from the actual visible text of
// assets/forms/wellness-exam-{en,es}.pdf (its printed heading is "WELLNESS
// EXAM VERIFICATION FORM" / "FORMULARIO DE VERIFICACIÓN DEL EXAMEN DE
// BIENESTAR"). Several variants are listed since OCR line-wrapping or minor
// header rewording shouldn't cause an otherwise-correct upload to fail this
// check.
const FORM_IDENTITY_KEYWORDS = ["wellness exam", "verification form", "examen de bienestar", "formulario de verificación"];

// Matches a filled-in date like "3/15/2026" or "03-15-26". The blank
// template's date fields are underscores ("_____/_____/_____"), which
// contain no digits, so this only matches once someone has actually written
// a date in — it isn't fooled by an unfilled date field itself.
const NUMERIC_DATE_PATTERN = /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/;
const MONTH_NAME_DATE_PATTERN =
  /\b(january|february|march|april|may|june|july|august|september|october|november|december|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+\d{1,2},?\s+\d{4}\b/i;

// The form's own printed instructions ("*must be between 1/1/26-12/31/26" /
// "*debe ser entre el 1/1/26 y el 31/12/26") contain date-shaped text, so a
// completely blank, unsigned upload would otherwise pass the date check on
// its instructional footnote alone. This line is excluded before testing.
const INSTRUCTIONAL_DATE_RANGE_PATTERN = /\*?\s*(must be between|debe ser entre)[^\n]*/gi;

interface OcrSpan {
  length: number;
}

interface OcrStyle {
  isHandwritten?: boolean;
  confidence: number;
  spans?: OcrSpan[];
}

function withInstructionalDateRangeRemoved(content: string): string {
  return content.replace(INSTRUCTIONAL_DATE_RANGE_PATTERN, "");
}

/**
 * Pure post-processing of an OCR result: whether the uploaded document (a)
 * looks like the actual Wellness Exam Verification Form, (b) has a
 * completed date written in, and (c) has a handwritten signature. All three
 * are presence-check heuristics, not exact validation (no confirmation the
 * date falls in the right cycle year, or whose signature it is) — false
 * positives/negatives land in `needs_review` for HR to resolve, and the
 * summary lists every failing check so the dashboard tooltip is specific.
 * Extracted from AzureDocumentIntelligenceVerifier so it's unit-testable
 * without mocking the Document Intelligence network client.
 */
export function evaluateOcrResult(content: string, styles: OcrStyle[]): VerificationResult {
  if (content.trim().length < MIN_TEXT_LENGTH) {
    return { passed: false, summary: "Document appears blank or unreadable — needs manual review." };
  }

  const reasons: string[] = [];
  const normalized = content.toLowerCase();

  const looksLikeCorrectForm = FORM_IDENTITY_KEYWORDS.some((keyword) => normalized.includes(keyword));
  if (!looksLikeCorrectForm) reasons.push("doesn't appear to be the Wellness Exam Verification Form");

  const contentForDateCheck = withInstructionalDateRangeRemoved(content);
  const hasDate = NUMERIC_DATE_PATTERN.test(contentForDateCheck) || MONTH_NAME_DATE_PATTERN.test(contentForDateCheck);
  if (!hasDate) reasons.push("no completed date found");

  const hasHandwrittenSignature = styles.some(
    (style) =>
      style.isHandwritten &&
      style.confidence >= HANDWRITING_CONFIDENCE_THRESHOLD &&
      (style.spans ?? []).some((span) => span.length >= MIN_HANDWRITTEN_SPAN_LENGTH)
  );
  if (!hasHandwrittenSignature) reasons.push("no handwritten signature detected");

  if (reasons.length > 0) {
    return { passed: false, summary: `Needs manual review: ${reasons.join("; ")}.` };
  }
  return { passed: true, summary: "Looks like the correct form, with a completed date and a handwritten signature." };
}

/**
 * Runs the uploaded form through Azure AI Document Intelligence's prebuilt
 * "read" model (OCR), then hands the extracted text/styles to
 * evaluateOcrResult for the actual pass/fail logic.
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
    return evaluateOcrResult(result.content ?? "", result.styles ?? []);
  }
}
