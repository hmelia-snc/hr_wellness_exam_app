import type { EmailSender, PhysicalFormEmail, UploadConfirmationEmail, RejectionEmail } from "./types.js";

/** Local-dev stand-in for the Graph sender: logs instead of sending. */
export class MockEmailSender implements EmailSender {
  async send(email: PhysicalFormEmail): Promise<void> {
    console.log(
      `[mock-email] To: ${email.toName} <${email.toEmail}> | Subject: ${email.cycleYear} Wellness Exam Verification | Link: ${email.link}`
    );
  }

  async sendUploadConfirmation(email: UploadConfirmationEmail): Promise<void> {
    console.log(
      `[mock-email] Upload confirmation to: ${email.toName} <${email.toEmail}> (cc HR) | ${email.cycleYear} | submitterRole=${email.submitterRole} | isComplete=${email.isComplete}${email.isComplete ? "" : ` | link=${email.link}`}`
    );
  }

  async sendRejection(email: RejectionEmail): Promise<void> {
    console.log(
      `[mock-email] Rejection to: ${email.toName} <${email.toEmail}> (cc HR) | ${email.cycleYear} | reason="${email.reason}" | link=${email.link}`
    );
  }
}
