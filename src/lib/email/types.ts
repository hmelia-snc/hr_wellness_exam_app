export interface PhysicalFormEmail {
  toEmail: string;
  toName: string;
  link: string;
  cycleYear: number;
}

export interface UploadConfirmationEmail {
  toEmail: string;
  toName: string;
  cycleYear: number;
  // Which form was just uploaded — wording differs slightly ("your form" vs
  // "your spouse's form"), and an employee with a spouse form on file can
  // trigger this once for each, independently.
  submitterRole: "employee" | "spouse";
  // False when a spouse form is required and only one of the two has
  // arrived so far — the email then says which one is still outstanding
  // and includes `link` back to the upload page instead of the usual
  // "you're all set" wording.
  isComplete: boolean;
  link: string;
}

export interface EmailSender {
  send(email: PhysicalFormEmail): Promise<void>;
  sendUploadConfirmation(email: UploadConfirmationEmail): Promise<void>;
}
