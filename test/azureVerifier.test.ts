import { describe, expect, it } from "vitest";
import { evaluateOcrResult } from "../src/lib/verification/azureVerifier.js";

// A real handwritten signature spans several characters in one contiguous
// run — matches what a genuine "Jane Doe" signature would look like as a
// single OCR'd span.
const SIGNED_STYLE = [{ isHandwritten: true, confidence: 0.8, spans: [{ length: 8 }] }];
const UNSIGNED_STYLE = [{ isHandwritten: false, confidence: 0.9, spans: [{ length: 8 }] }];
// Per a real Document Intelligence smoke test against the blank template, a
// stray "1" and "/" from the unfilled date field's placeholder both got
// misclassified as handwritten (confidence 0.6-0.7) — noise, not a
// signature, since each is only a single character.
const NOISE_STYLE = [
  { isHandwritten: true, confidence: 0.6, spans: [{ length: 1 }] },
  { isHandwritten: true, confidence: 0.7, spans: [{ length: 1 }] },
];

const GOOD_ENGLISH_CONTENT = `
WELLNESS EXAM VERIFICATION FORM
Patient Full Legal Name (printed): Jane Doe
Date of Annual Preventive Examination: 3/15/2026
*must be between 1/1/26-12/31/26
Physician Signature: (signed)
`;

describe("evaluateOcrResult", () => {
  it("passes when the form is identifiable, a date is filled in, and a signature is present", () => {
    const result = evaluateOcrResult(GOOD_ENGLISH_CONTENT, SIGNED_STYLE);
    expect(result.passed).toBe(true);
    expect(result.summary).toMatch(/correct form/i);
  });

  it("fails as blank/unreadable when there's barely any text", () => {
    const result = evaluateOcrResult("hi", SIGNED_STYLE);
    expect(result.passed).toBe(false);
    expect(result.summary).toMatch(/blank or unreadable/i);
  });

  it("flags a document that doesn't look like the Wellness Exam form", () => {
    const content = "Some Unrelated Document with a date 3/15/2026 and enough padding text to pass the length check.";
    const result = evaluateOcrResult(content, SIGNED_STYLE);
    expect(result.passed).toBe(false);
    expect(result.summary).toMatch(/doesn't appear to be the Wellness Exam Verification Form/);
  });

  it("flags a missing completed date", () => {
    const content = GOOD_ENGLISH_CONTENT.replace("3/15/2026", "___/___/___");
    const result = evaluateOcrResult(content, SIGNED_STYLE);
    expect(result.passed).toBe(false);
    expect(result.summary).toMatch(/no completed date found/);
  });

  it("flags a missing handwritten signature", () => {
    const result = evaluateOcrResult(GOOD_ENGLISH_CONTENT, UNSIGNED_STYLE);
    expect(result.passed).toBe(false);
    expect(result.summary).toMatch(/no handwritten signature detected/);
  });

  it("lists every failing reason together", () => {
    const content = "Some Unrelated Document with enough padding text to clear the minimum length check for OCR.";
    const result = evaluateOcrResult(content, UNSIGNED_STYLE);
    expect(result.passed).toBe(false);
    expect(result.summary).toMatch(/doesn't appear to be the Wellness Exam Verification Form/);
    expect(result.summary).toMatch(/no completed date found/);
    expect(result.summary).toMatch(/no handwritten signature detected/);
  });

  it("matches the Spanish form heading and a month-name date", () => {
    const content = `
      FORMULARIO DE VERIFICACIÓN DEL EXAMEN DE BIENESTAR
      Fecha del examen preventivo anual: March 15, 2026
    `;
    const result = evaluateOcrResult(content, SIGNED_STYLE);
    expect(result.passed).toBe(true);
  });

  it("is case-insensitive for the form-identity keywords", () => {
    const content = GOOD_ENGLISH_CONTENT.toLowerCase();
    const result = evaluateOcrResult(content, SIGNED_STYLE);
    expect(result.passed).toBe(true);
  });

  // Regression coverage for a real bug caught via a live Document
  // Intelligence smoke test against the actual blank template PDF: without
  // these two fixes, an entirely blank, unsigned upload would have
  // auto-passed both the date and signature checks.
  describe("regression: blank template false positives", () => {
    it("does not treat the form's own instructional date range as a completed date", () => {
      const content = `
        WELLNESS EXAM VERIFICATION FORM
        Date of Annual Preventive Examination: _____/_____/_____
        *must be between 1/1/26-12/31/26
        Physician Signature: ______________________________
      `;
      const result = evaluateOcrResult(content, SIGNED_STYLE);
      expect(result.passed).toBe(false);
      expect(result.summary).toMatch(/no completed date found/);
    });

    it("does not treat isolated single-character handwritten noise as a signature", () => {
      const result = evaluateOcrResult(GOOD_ENGLISH_CONTENT, NOISE_STYLE);
      expect(result.passed).toBe(false);
      expect(result.summary).toMatch(/no handwritten signature detected/);
    });

    it("still finds a real date once the instructional line is stripped away", () => {
      const content = `
        WELLNESS EXAM VERIFICATION FORM
        Date of Annual Preventive Examination: 3/15/2026
        *must be between 1/1/26-12/31/26
        Physician Signature: ______________________________
      `;
      const result = evaluateOcrResult(content, SIGNED_STYLE);
      expect(result.summary).not.toMatch(/no completed date found/);
    });
  });
});
