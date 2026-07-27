import { prisma } from "../db/client.js";
import { getBlobStorage } from "../lib/blobStorage.js";
import { getEmailSender } from "../lib/email/index.js";
import { getFormVerifier } from "../lib/verification/index.js";
import { createApp } from "../server.js";
import { getEnv } from "../config/env.js";

// Last-resort safety net: a rejected promise that isn't awaited/caught
// anywhere (a bug in a route handler, a future fire-and-forget call, etc.)
// would otherwise crash the entire Node process by default, taking every
// in-flight request down with it over one transient error. Logging and
// continuing means the one bad code path fails on its own instead of
// taking the whole site offline.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection (server kept running):", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception (server kept running):", err);
});

const env = getEnv();
const app = createApp(prisma, getBlobStorage(), getEmailSender(), getFormVerifier());

app.listen(env.PORT, () => {
  console.log(`HR Physical Form Tracker listening on http://localhost:${env.PORT}`);
});
