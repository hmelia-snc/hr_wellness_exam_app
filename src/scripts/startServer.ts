import { prisma } from "../db/client.js";
import { getBlobStorage } from "../lib/blobStorage.js";
import { createApp } from "../server.js";
import { getEnv } from "../config/env.js";

const env = getEnv();
const app = createApp(prisma, getBlobStorage());

app.listen(env.PORT, () => {
  console.log(`HR Physical Form Tracker listening on http://localhost:${env.PORT}`);
});
