import "isomorphic-fetch";
import { ClientSecretCredential } from "@azure/identity";
import { Client } from "@microsoft/microsoft-graph-client";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js";
import type { EmailSender, PhysicalFormEmail, UploadConfirmationEmail } from "./types.js";
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
