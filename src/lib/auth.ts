import type { Request, Response, NextFunction } from "express";

export interface HrUser {
  name: string;
  email: string;
}

declare module "express-session" {
  interface SessionData {
    hrUser?: HrUser;
  }
}

export function requireHrAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.session.hrUser) {
    next();
    return;
  }
  res.redirect(`/auth/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
}
