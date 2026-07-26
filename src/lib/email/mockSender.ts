import type { EmailSender, PhysicalFormEmail } from "./types.js";

/** Local-dev stand-in for the Graph sender: logs instead of sending. */
export class MockEmailSender implements EmailSender {
  async send(email: PhysicalFormEmail): Promise<void> {
    console.log(
      `[mock-email] To: ${email.toName} <${email.toEmail}> | Subject: ${email.cycleYear} Annual Physical Form | Link: ${email.link}`
    );
  }
}
