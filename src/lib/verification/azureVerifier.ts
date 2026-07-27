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
// Fallback cap on how far past a signature label to look for ink, for the
// (rare) case a boundary marker isn't found nearby.
const MAX_SIGNATURE_REGION_LENGTH = 150;

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

// The form requires two independent signatures — the physician certifying
// the exam happened, and the employee/spouse certifying they understand the
// wellness policy — and per a real (partially-completed) test scan, having
// one without the other is a genuinely incomplete submission, not just a
// heuristic false negative. Each is checked in its own text region rather
// than "is there handwriting anywhere on the page," because a real test
// scan showed why that's not equivalent: the employee/spouse signature line
// sits directly beside a "Date:" field on the same line
// ("Employee/Spouse Signature: ____  Date: ____"), and a filled-in date
// with a blank signature would otherwise read as a signed line if the
// check didn't stop at that boundary.
const PHYSICIAN_SIGNATURE_LABEL_PATTERN = /physician signature|firma del médico/i;
const EMPLOYEE_SIGNATURE_LABEL_PATTERN = /employee\/spouse signature|firma del empleado\/cónyuge/i;
// A region also ends the moment the OTHER signature's own label shows up —
// without this, a form whose two signature labels sit back-to-back (no
// "Date:"/"Physician Certification" text in between) would let one
// signature's ink bleed into the other's region.
const SIGNATURE_REGION_BOUNDARY_PATTERN = new RegExp(
  [
    "\\bdate\\b",
    "\\bfecha\\b",
    PHYSICIAN_SIGNATURE_LABEL_PATTERN.source,
    EMPLOYEE_SIGNATURE_LABEL_PATTERN.source,
    "physician certification",
    "certificación del médico",
    "employee\\/spouse information",
    "información del empleado",
    "\\*\\s*please submit",
    "\\*\\s*por favor",
    "\\*\\s*must be between",
    "\\*\\s*debe ser entre",
  ].join("|"),
  "i"
);

interface OcrSpan {
  offset: number;
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

interface TextRegion {
  start: number;
  end: number;
}

/**
 * Finds the text immediately following a signature label, up to whichever
 * comes first: a known boundary marker (a sibling field on the same line,
 * or the start of the next section) or a fallback max length. Returns null
 * if the label itself isn't found at all — OCR failing to recognize the
 * label is treated the same as a missing signature (can't confirm it,
 * needs a human to look), not assumed present.
 */
function findSignatureRegion(content: string, labelPattern: RegExp): TextRegion | null {
  const labelMatch = labelPattern.exec(content);
  if (!labelMatch) return null;

  const regionStart = labelMatch.index + labelMatch[0].length;
  const rest = content.slice(regionStart);
  const boundaryMatch = SIGNATURE_REGION_BOUNDARY_PATTERN.exec(rest);
  const regionEnd = regionStart + (boundaryMatch ? boundaryMatch.index : Math.min(rest.length, MAX_SIGNATURE_REGION_LENGTH));
  return { start: regionStart, end: regionEnd };
}

function hasQualifyingHandwritingInRegion(styles: OcrStyle[], region: TextRegion): boolean {
  return styles.some(
    (style) =>
      style.isHandwritten &&
      style.confidence >= HANDWRITING_CONFIDENCE_THRESHOLD &&
      (style.spans ?? []).some(
        (span) => span.length >= MIN_HANDWRITTEN_SPAN_LENGTH && span.offset >= region.start && span.offset < region.end
      )
  );
}

function hasSignature(content: string, styles: OcrStyle[], labelPattern: RegExp): boolean {
  const region = findSignatureRegion(content, labelPattern);
  if (!region) return false;
  return hasQualifyingHandwritingInRegion(styles, region);
}

/**
 * Pure post-processing of an OCR result: whether the uploaded document (a)
 * looks like the actual Wellness Exam Verification Form, (b) has a
 * completed date written in, and (c) has both the physician's and the
 * employee/spouse's signatures. All three are presence-check heuristics,
 * not exact validation (no confirmation the date falls in the right cycle
 * year, or whose signature it is) — false positives/negatives land in
 * `needs_review` for HR to resolve, and the summary lists every failing
 * check so the dashboard tooltip is specific. Extracted from
 * AzureDocumentIntelligenceVerifier so it's unit-testable without mocking
 * the Document Intelligence network client.
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

  if (!hasSignature(content, styles, PHYSICIAN_SIGNATURE_LABEL_PATTERN)) reasons.push("physician signature missing");
  if (!hasSignature(content, styles, EMPLOYEE_SIGNATURE_LABEL_PATTERN)) reasons.push("employee/spouse signature missing");

  if (reasons.length > 0) {
    return { passed: false, summary: `Needs manual review: ${reasons.join("; ")}.` };
  }
  return {
    passed: true,
    summary: "Looks like the correct form, with a completed date and both the physician's and employee/spouse's signatures.",
  };
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
