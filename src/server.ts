import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env["SENTRY_DSN"],
  tracesSampleRate: 1.0,
  environment: process.env["NODE_ENV"] ?? "development",
  enabled: !!process.env["SENTRY_DSN"],
});

import { createApp } from "@/app";
import { prisma } from "@/config/prisma";
import { validateEnv } from "@/config/env";
import { redisClient } from "@/lib/redis";
import { startHairAnalysisWorker } from "@/jobs/hair-analysis.worker"
import { startContactEmailWorker } from "@/jobs/contact-email.worker"
import { startCleanupWorker } from "@/jobs/cleanup.worker"
import { startSyncShopsWorker } from "@/jobs/sync-shops.worker"
const env = validateEnv();
const app = createApp(env);

let httpServer: ReturnType<typeof app.listen> | undefined;

const shutdown = async () => {
  if (httpServer) {
    httpServer.closeAllConnections?.()
    await new Promise<void>((resolve) => httpServer!.close(() => resolve()))
  }
  await Promise.allSettled([prisma.$disconnect(), redisClient.quit()])
  process.exit(0)
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

const start = async () => {
  startHairAnalysisWorker()
  startContactEmailWorker()
  await startCleanupWorker()
  await startSyncShopsWorker()
  httpServer = app.listen(env.PORT, () => {
    console.log(`Server running on port ${env.PORT} [${env.NODE_ENV}]`);
  });
};

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
