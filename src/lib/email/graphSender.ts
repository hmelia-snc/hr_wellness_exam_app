import "isomorphic-fetch";
import { ClientSecretCredential } from "@azure/identity";
import { Client } from "@microsoft/microsoft-graph-client";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js";
import type { EmailSender, PhysicalFormEmail } from "./types.js";
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

  async send(email: PhysicalFormEmail): Promise<void> {
    // Arial, not Ubuntu: email clients strip web fonts, and Arial is the
    // brand guide's own sanctioned fallback for exactly this constraint.
    await this.client.api(`/users/${this.senderAddress}/sendMail`).post({
      message: {
        subject: `${email.cycleYear} Annual Physical Form`,
        body: {
          contentType: "HTML",
          content: `
            <div style="font-family: Arial, sans-serif; color: #2C2A29;">
              <p style="font-weight: bold; text-transform: uppercase; letter-spacing: 0.03em; border-bottom: 3px solid #DA291C; padding-bottom: 0.5rem;">
                Standard Nutrition Company
              </p>
              <p>Hi ${escapeHtml(email.toName)},</p>
              <p>Please download, complete, and upload your ${email.cycleYear} annual physical
              exam form using your personal link below:</p>
              <p><a href="${email.link}" style="color: #DA291C;">${email.link}</a></p>
            </div>
          `,
        },
        toRecipients: [{ emailAddress: { address: email.toEmail } }],
      },
      saveToSentItems: true,
    });
  }
}
