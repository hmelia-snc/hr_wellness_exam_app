import "isomorphic-fetch";
import { ClientSecretCredential } from "@azure/identity";
import { Client } from "@microsoft/microsoft-graph-client";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js";
import type { EmailSender, PhysicalFormEmail, UploadConfirmationEmail, RejectionEmail } from "./types.js";
import type { Env } from "../../config/env.js";
import { escapeHtml } from "../html.js";

/**
 * Sends mail via Microsoft Graph, authenticated as the app registration
 * (client credentials flow) and sending as the shared mailbox — not an
 * individual user's mailbox.
 */
export class GraphEmailSender implements EmailSender {
  private client: Client;
  private senderAddress: string;

  constructor(env: Pick<Env, "AZURE_TENANT_ID" | "AZURE_CLIENT_ID" | "AZURE_CLIENT_SECRET" | "MAIL_SENDER_ADDRESS">) {
    const credential = new ClientSecretCredential(
      env.AZURE_TENANT_ID!,
      env.AZURE_CLIENT_ID!,
      env.AZURE_CLIENT_SECRET!
    );
    const authProvider = new TokenCredentialAuthenticationProvider(credential, {
      scopes: ["https://graph.microsoft.com/.default"],
    });
    this.client = Client.initWithMiddleware({ authProvider });
    this.senderAddress = env.MAIL_SENDER_ADDRESS;
  }

  // Arial, not Ubuntu: email clients strip web fonts, and Arial is the
  // brand guide's own sanctioned fallback for exactly this constraint.
  private brandHeader(): string {
    return `
      <p style="font-weight: bold; text-transform: uppercase; letter-spacing: 0.03em; border-bottom: 3px solid #DA291C; padding-bottom: 0.5rem;">
        Standard Nutrition Company
      </p>
    `;
  }

  // Adapted from the company's standard CodeTwo email signature template
  // (assets normally merge-filled per sender — {First name}, {Title},
  // {Mobile}, etc.). These emails come from the shared app mailbox rather
  // than an individual, so the name is fixed to "Standard HR Team" and the
  // personal fields (title, direct/mobile/fax numbers) that have no value
  // for a shared inbox are dropped rather than left as empty placeholders.
  private brandFooter(): string {
    return `
      <table cellspacing="0" cellpadding="0" border="0" style="margin-top: 24px; font-family: Arial, sans-serif;">
        <tbody>
          <tr>
            <td style="padding: 0 0 8px 0;">
              <b style="font-family: Arial, sans-serif; color: #9A3324; font-size: 12pt;">Standard HR Team</b>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 0 12px 0;">
              <a href="https://standardnutrition.com/" title="Visit StandardNutrition.com">
                <img src="https://shortlink.standardnutrition.com/signatures/codetwo/SNC-logo-250x90.jpg" border="0" alt="Standard Nutrition Company" width="250" height="90" style="display: block;">
              </a>
            </td>
          </tr>
          <tr>
            <td>
              <a href="https://www.facebook.com/StandardNutrition" title="Visit Standard Nutrition's Facebook">
                <img src="https://shortlink.standardnutrition.com/signatures/codetwo/fb-icon.png" border="0" alt="Facebook" width="20" height="20" style="vertical-align: middle;">
              </a>
              &nbsp;
              <a href="https://www.linkedin.com/company/standardnutritioncompany/" title="Visit Standard Nutrition's LinkedIn">
                <img src="https://shortlink.standardnutrition.com/signatures/codetwo/LinkedIN-icon.png" border="0" alt="LinkedIn" width="20" height="20" style="vertical-align: middle;">
              </a>
              &nbsp;
              <a href="https://standardnutrition.com/" title="Visit StandardNutrition.com">
                <img src="https://shortlink.standardnutrition.com/signatures/codetwo/WWW-icon.png" border="0" alt="Website" width="20" height="20" style="vertical-align: middle;">
              </a>
              &nbsp;
              <a href="https://standardnutrition.com/" style="font-family: Arial, sans-serif; font-size: 12px; text-decoration: none;">
                <b style="color: #9A3324;">StandardNutrition.com</b>
              </a>
            </td>
          </tr>
        </tbody>
      </table>
    `;
  }

  async send(email: PhysicalFormEmail): Promise<void> {
    await this.client.api(`/users/${this.senderAddress}/sendMail`).post({
      message: {
        subject: `${email.cycleYear} Wellness Exam Verification`,
        body: {
          contentType: "HTML",
          content: `
            <div style="font-family: Arial, sans-serif; color: #2C2A29;">
              ${this.brandHeader()}
              <p>Hi ${escapeHtml(email.toName)},</p>
              <p>Please download, complete, and upload your ${email.cycleYear} Wellness Exam
              Verification form using your personal link below:</p>
              <p><a href="${email.link}" style="color: #DA291C;">${email.link}</a></p>
              ${this.brandFooter()}
            </div>
          `,
        },
        toRecipients: [{ emailAddress: { address: email.toEmail } }],
      },
      saveToSentItems: true,
    });
  }

  async sendUploadConfirmation(email: UploadConfirmationEmail): Promise<void> {
    const whoseForm = email.submitterRole === "spouse" ? "your spouse's" : "your";
    const otherForm = email.submitterRole === "spouse" ? "your own" : "your spouse's";

    const bodyContent = email.isComplete
      ? `<p>Thank you for submitting ${whoseForm} ${email.cycleYear} Wellness Exam
         Verification form. We've received it, and it will be reviewed by HR shortly — you
         don't need to do anything else right now. We'll follow up if we need any additional
         information.</p>`
      : `<p>Thank you for submitting ${whoseForm} ${email.cycleYear} Wellness Exam
         Verification form — we've received it!</p>
         <p>We're still waiting on ${otherForm} form to complete this cycle's requirement.
         Please use the link below to submit it when it's ready:</p>
         <p><a href="${email.link}" style="color: #DA291C;">${email.link}</a></p>`;

    await this.client.api(`/users/${this.senderAddress}/sendMail`).post({
      message: {
        subject: `${email.cycleYear} Wellness Exam Verification Received — Thank You!`,
        body: {
          contentType: "HTML",
          content: `
            <div style="font-family: Arial, sans-serif; color: #2C2A29;">
              ${this.brandHeader()}
              <p>Hi ${escapeHtml(email.toName)},</p>
              ${bodyContent}
              ${this.brandFooter()}
            </div>
          `,
        },
        toRecipients: [{ emailAddress: { address: email.toEmail } }],
        ccRecipients: [{ emailAddress: { address: this.senderAddress } }],
      },
      saveToSentItems: true,
    });
  }

  async sendRejection(email: RejectionEmail): Promise<void> {
    await this.client.api(`/users/${this.senderAddress}/sendMail`).post({
      message: {
        subject: `${email.cycleYear} Wellness Exam Verification — Needs Attention`,
        body: {
          contentType: "HTML",
          content: `
            <div style="font-family: Arial, sans-serif; color: #2C2A29;">
              ${this.brandHeader()}
              <p>Hi ${escapeHtml(email.toName)},</p>
              <p>HR reviewed your ${email.cycleYear} Wellness Exam Verification form submission and
              it couldn't be accepted as-is:</p>
              <p style="background: #FBE9E8; border: 1px solid #F0C3C0; border-radius: 6px; padding: 0.75rem 1rem; color: #9A3324;">
                ${escapeHtml(email.reason)}
              </p>
              <p>Please use the link below to review and resubmit your form:</p>
              <p><a href="${email.link}" style="color: #DA291C;">${email.link}</a></p>
              ${this.brandFooter()}
            </div>
          `,
        },
        toRecipients: [{ emailAddress: { address: email.toEmail } }],
        ccRecipients: [{ emailAddress: { address: this.senderAddress } }],
      },
      saveToSentItems: true,
    });
  }
}
