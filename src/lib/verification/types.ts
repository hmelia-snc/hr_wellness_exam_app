export interface VerificationResult {
  passed: boolean;
  summary: string;
}

export interface FormVerifier {
  verify(buffer: Buffer, contentType: string): Promise<VerificationResult>;
}
