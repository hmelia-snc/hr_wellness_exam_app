export interface PhysicalFormEmail {
  toEmail: string;
  toName: string;
  link: string;
  cycleYear: number;
}

export interface EmailSender {
  send(email: PhysicalFormEmail): Promise<void>;
}
