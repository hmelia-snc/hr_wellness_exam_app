import { getEnv } from "../../config/env.js";
import { MockFormVerifier } from "./mockVerifier.js";
import { AzureDocumentIntelligenceVerifier } from "./azureVerifier.js";
import type { FormVerifier } from "./types.js";

export type { FormVerifier, VerificationResult } from "./types.js";

let cachedVerifier: FormVerifier | undefined;

export function getFormVerifier(): FormVerifier {
  if (!cachedVerifier) {
    const env = getEnv();
    cachedVerifier = env.VERIFICATION_MODE === "azure" ? new AzureDocumentIntelligenceVerifier(env) : new MockFormVerifier();
  }
  return cachedVerifier;
}
