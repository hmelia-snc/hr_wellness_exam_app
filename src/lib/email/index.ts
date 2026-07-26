import { getEnv } from "../../config/env.js";
import { MockEmailSender } from "./mockSender.js";
import { GraphEmailSender } from "./graphSender.js";
import type { EmailSender } from "./types.js";

export type { EmailSender, PhysicalFormEmail } from "./types.js";

let cachedSender: EmailSender | undefined;

export function getEmailSender(): EmailSender {
  if (!cachedSender) {
    const env = getEnv();
    cachedSender = env.EMAIL_MODE === "graph" ? new GraphEmailSender(env) : new MockEmailSender();
  }
  return cachedSender;
}
