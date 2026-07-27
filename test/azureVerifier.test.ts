import { describe, expect, it } from "vitest";
import { evaluateOcrResult } from "../src/lib/verification/azureVerifier.js";

const GOOD_ENGLISH_CONTENT = `
WELLNESS EXAM VERIFICATION FORM
Patient Full Legal Name (printed): Jane Doe
Date of Annual Preventive Examination: 3/15/2026
*must be between 1/1/26-12/31/26
Employee/Spouse Signature: (signed)
Physician Signature: (signed)
`;

const employeeSignatureOffset = GOOD_ENGLISH_CONTENT.indexOf("Employee/Spouse Signature:") + "Employee/Spouse Signature:".length + 1;
const physicianSignatureOffset = GOOD_ENGLISH_CONTENT.indexOf("Physician Signature:") + "Physician Signature:".length + 1;

// A real handwritten signature spans several characters in one contiguous
// run — matches what a genuine "Jane Doe" signature would look like as a
// single OCR'd span, positioned right where each label's ink would actually
// land.
const BOTH_SIGNED_STYLE = [
  { isHandwritten: true, confidence: 0.8, spans: [{ offset: employeeSignatureOffset, length: 8 }] },
  { isHandwritten: true, confidence: 0.8, spans: [{ offset: physicianSignatureOffset, length: 8 }] },
];
const ONLY_PHYSICIAN_SIGNED_STYLE = [{ isHandwritten: true, confidence: 0.8, spans: [{ offset: physicianSignatureOffset, length: 8 }] }];
const ONLY_EMPLOYEE_SIGNED_STYLE = [{ isHandwritten: true, confidence: 0.8, spans: [{ offset: employeeSignatureOffset, length: 8 }] }];
const NEITHER_SIGNED_STYLE: { isHandwritten: boolean; confidence: number; spans: { offset: number; length: number }[] }[] = [];
// Per a real Document Intelligence smoke test against the blank template, a
// stray "1" and "/" from the unfilled date field's placeholder both got
// misclassified as handwritten (confidence 0.6-0.7) — noise, not a
// signature, since each is only a single character.
const NOISE_STYLE = [
  { isHandwritten: true, confidence: 0.6, spans: [{ offset: physicianSignatureOffset, length: 1 }] },
  { isHandwritten: true, confidence: 0.7, spans: [{ offset: employeeSignatureOffset, length: 1 }] },
];

describe("evaluateOcrResult", () => {
  it("passes when the form is identifiable, a date is filled in, and both signatures are present", () => {
    const result = evaluateOcrResult(GOOD_ENGLISH_CONTENT, BOTH_SIGNED_STYLE);
    expect(result.passed).toBe(true);
    expect(result.summary).toMatch(/correct form/i);
  });

  it("fails as blank/unreadable when there's barely any text", () => {
    const result = evaluateOcrResult("hi", BOTH_SIGNED_STYLE);
    expect(result.passed).toBe(false);
    expect(result.summary).toMatch(/blank or unreadable/i);
  });

  it("flags a document that doesn't look like the Wellness Exam form", () => {
    const content = "Some Unrelated Document with a date 3/15/2026 and enough padding text to pass the length check.";
    const result = evaluateOcrResult(content, BOTH_SIGNED_STYLE);
    expect(result.passed).toBe(false);
    expect(result.summary).toMatch(/doesn't appear to be the Wellness Exam Verification Form/);
  });

  it("flags a missing completed date", () => {
    const content = GOOD_ENGLISH_CONTENT.replace("3/15/2026", "___/___/___");
    const result = evaluateOcrResult(content, BOTH_SIGNED_STYLE);
    expect(result.passed).toBe(false);
    expect(result.summary).toMatch(/no completed date found/);
  });

  it("flags a missing physician signature when only the employee/spouse signed", () => {
    const result = evaluateOcrResult(GOOD_ENGLISH_CONTENT, ONLY_EMPLOYEE_SIGNED_STYLE);
    expect(result.passed).toBe(false);
    expect(result.summary).toMatch(/physician signature missing/);
    expect(result.summary).not.toMatch(/employee\/spouse signature missing/);
  });

  it("flags a missing employee/spouse signature when only the physician signed", () => {
    const result = evaluateOcrResult(GOOD_ENGLISH_CONTENT, ONLY_PHYSICIAN_SIGNED_STYLE);
    expect(result.passed).toBe(false);
    expect(result.summary).toMatch(/employee\/spouse signature missing/);
    expect(result.summary).not.toMatch(/physician signature missing/);
  });

  it("flags both signatures missing when neither is present", () => {
    const result = evaluateOcrResult(GOOD_ENGLISH_CONTENT, NEITHER_SIGNED_STYLE);
    expect(result.passed).toBe(false);
    expect(result.summary).toMatch(/physician signature missing/);
    expect(result.summary).toMatch(/employee\/spouse signature missing/);
  });

  it("lists every failing reason together", () => {
    const content = "Some Unrelated Document with enough padding text to clear the minimum length check for OCR.";
    const result = evaluateOcrResult(content, NEITHER_SIGNED_STYLE);
    expect(result.passed).toBe(false);
    expect(result.summary).toMatch(/doesn't appear to be the Wellness Exam Verification Form/);
    expect(result.summary).toMatch(/no completed date found/);
    expect(result.summary).toMatch(/physician signature missing/);
    expect(result.summary).toMatch(/employee\/spouse signature missing/);
  });

  it("matches the Spanish form heading and a month-name date", () => {
    const content = `
      FORMULARIO DE VERIFICACIÓN DEL EXAMEN DE BIENESTAR
      Fecha del examen preventivo anual: March 15, 2026
      Firma del empleado/cónyuge: (signed)
      Firma del médico: (signed)
    `;
    const employeeOffset = content.indexOf("Firma del empleado/cónyuge:") + "Firma del empleado/cónyuge:".length + 1;
    const physicianOffset = content.indexOf("Firma del médico:") + "Firma del médico:".length + 1;
    const result = evaluateOcrResult(content, [
      { isHandwritten: true, confidence: 0.8, spans: [{ offset: employeeOffset, length: 8 }] },
      { isHandwritten: true, confidence: 0.8, spans: [{ offset: physicianOffset, length: 8 }] },
    ]);
    expect(result.passed).toBe(true);
  });

  it("is case-insensitive for the form-identity keywords", () => {
    const content = GOOD_ENGLISH_CONTENT.toLowerCase();
    const employeeOffset = content.indexOf("employee/spouse signature:") + "employee/spouse signature:".length + 1;
    const physicianOffset = content.indexOf("physician signature:") + "physician signature:".length + 1;
    const result = evaluateOcrResult(content, [
      { isHandwritten: true, confidence: 0.8, spans: [{ offset: employeeOffset, length: 8 }] },
      { isHandwritten: true, confidence: 0.8, spans: [{ offset: physicianOffset, length: 8 }] },
    ]);
    expect(result.passed).toBe(true);
  });

  describe("regression: blank template false positives", () => {
    it("does not treat the form's own instructional date range as a completed date", () => {
      const content = `
        WELLNESS EXAM VERIFICATION FORM
        Date of Annual Preventive Examination: _____/_____/_____
        *must be between 1/1/26-12/31/26
        Employee/Spouse Signature: ______________________________
        Physician Signature: ______________________________
      `;
      const result = evaluateOcrResult(content, BOTH_SIGNED_STYLE);
      expect(result.passed).toBe(false);
      expect(result.summary).toMatch(/no completed date found/);
    });

    it("does not treat isolated single-character handwritten noise as a signature", () => {
      const result = evaluateOcrResult(GOOD_ENGLISH_CONTENT, NOISE_STYLE);
      expect(result.passed).toBe(false);
      expect(result.summary).toMatch(/physician signature missing/);
      expect(result.summary).toMatch(/employee\/spouse signature missing/);
    });

    it("still finds a real date once the instructional line is stripped away", () => {
      const content = `
        WELLNESS EXAM VERIFICATION FORM
        Date of Annual Preventive Examination: 3/15/2026
        *must be between 1/1/26-12/31/26
        Physician Signature: ______________________________
      `;
      const result = evaluateOcrResult(content, BOTH_SIGNED_STYLE);
      expect(result.summary).not.toMatch(/no completed date found/);
    });
  });

  // Regression coverage from a real scanned test form (Test Forms/Scanned
  // from Standard Nutrition[85].pdf) run through the actual Azure Document
  // Intelligence API: only the top ("Employee/Spouse Information") section
  // was filled in, with neither signature line actually signed. The two
  // handwritten spans that DO exist — the printed patient name "JOHN DOE"
  // and a date "7/27/2020" written next to (not on) the Employee/Spouse
  // Signature line — used to be enough to satisfy the old global "any
  // handwriting anywhere" check. This is the exact false positive the
  // region-bounded per-signature check was built to catch.
  describe("regression: real partially-completed scan (neither signature line signed)", () => {
    const content =
      'WELLNESS EXAM VERIFICATION FORM\nSTANDARD NUTRITION COMPANY\nEmployee/Spouse Information (this section to be completed by employee/spouse)\nPatient Full Legal Name (printed):\nJOHN DOE\nRelationship to Employee: I am the employee\nI am the spouse of: (employee\'s name)\nCompany:\nBluebonnet\nBower Ag\nStandard Dairy Consultants\nStandard Nutrition Company\nStandard Nutrition Services\nMilk Unlimited\nI affirm that I have received, read, and understand the Wellness Policy, and I authorize my physician to release the date of my annual preventive exam for use in the Standard Nutrition Company wellness program. I understand that my participation in the Standard Nutrition Company wellness program is voluntary and that I am encouraged to complete a preventive wellness exam with my physician. If I choose to participate in any other services or screenings with my primary care physician, I will be responsible for out-of-pocket costs.\nEmployee/Spouse Signature:\nDate:\n7/27/2020\nPhysician Certification (this section to be completed by physician)\nAs a part of the Standard Nutrition Company wellness program, employees and their covered spouses are encouraged to participate in an annual preventive physical exam through their physician. Standard Nutrition Company is NOT requesting any medical records or protected health information pertaining to this exam. Once the exam is complete, sign and date this form then return it to your patient so that they may get credit. Please be sure to inform your patient that if other tests/services are conducted, they may be responsible for out-of-pocket costs based on their insurance plan. BCBS covers up to TWO wellness exams per calendar year. If you have any questions regarding the wellness program or this form, please reach out to us at hr@standardnutrition.com.\nBy completing and signing below, I certify that I have provided a routine health evaluation of this individual on the date provided below.\nDate of Annual Preventive Examination: 1\n/\n*must be between 1/1/26-12/31/26\nMedical Facility:\nPhysician Name (printed):\nPhysician Phone Number:\nPhysician Signature:\n*please submit charges to company insurance as routine preventive care. BCBS covers up to TWO wellness exams per calendar year.\nTo receive credit for completion of the annual preventive exam - Employees must electronically upload their form(s) on Microsoft Forms by clicking the "Submit Verification Form" link or scanning the QR code. Forms must be submitted by December 14th, 2026\nSUBMIT VERIFICATION FORM';
    const styles = [
      {
        isHandwritten: true,
        confidence: 1,
        spans: [
          { offset: 172, length: 8 }, // "JOHN DOE"
          { offset: 957, length: 9 }, // "7/27/2020"
        ],
      },
      {
        isHandwritten: true,
        confidence: 0.7,
        spans: [{ offset: 1977, length: 3 }], // OCR noise near the unfilled physician-side date field
      },
    ];

    it("is not marked complete — neither signature line actually has ink on it", () => {
      const result = evaluateOcrResult(content, styles);
      expect(result.passed).toBe(false);
      expect(result.summary).toMatch(/physician signature missing/);
      expect(result.summary).toMatch(/employee\/spouse signature missing/);
    });

    it("does not mistake the printed patient name for a signature", () => {
      const result = evaluateOcrResult(content, styles);
      expect(result.summary).toMatch(/employee\/spouse signature missing/);
    });

    it("does not mistake the date next to the Employee/Spouse Signature line for a signature", () => {
      const result = evaluateOcrResult(content, styles);
      expect(result.summary).toMatch(/employee\/spouse signature missing/);
    });
  });
});
