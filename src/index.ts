// src/index.ts

import "dotenv/config";
import { app } from "./app.js";
import { initNotificationWorker } from "./modules/notifications/notification.worker.js";
import { initOutboxWorker } from "./modules/notifications/outbox.worker.js";

// Fail fast in production if critical env vars are missing
if (process.env.NODE_ENV === "production") {
  const REQUIRED_ENV_VARS = [
    "DATABASE_URL",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "FRONTEND_URL",
    "ACCESS_TOKEN_SECRET",
    "REFRESH_TOKEN_SECRET",
    "ADMIN_ACCESS_TOKEN_SECRET",
    "ADMIN_REFRESH_TOKEN_SECRET",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_STORAGE_BUCKET",
    "SUPABASE_PROFILE_IMAGES_BUCKET",
    "UPSTASH_REDIS_URL",
    "RESEND_API_KEY",
  ];

  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (!process.env.GOOGLE_REDIRECT_URI && !process.env.GOOGLE_CALLBACK_URL) {
    missing.push("GOOGLE_REDIRECT_URI or GOOGLE_CALLBACK_URL");
  }

  if (missing.length > 0) {
    console.error(
      `❌ Missing required environment variables: ${missing.join(", ")}`,
    );
    process.exit(1);
  }
}

const PORT = process.env.PORT || 7292;

// Initialize background worker processes
let notificationWorkerInstance: ReturnType<typeof initNotificationWorker> | null = null;
let outboxWorkerInstance: ReturnType<typeof initOutboxWorker> | null = null;

if (process.env.DISABLE_NOTIFICATION_WORKER !== "true") {
  try {
    notificationWorkerInstance = initNotificationWorker();
    console.log("⚡ Notification Worker process initialized");
  } catch (workerErr) {
    console.error("⚠️ Failed to initialize Notification Worker:", workerErr);
  }

  try {
    outboxWorkerInstance = initOutboxWorker();
    console.log("⚡ Outbox Worker process initialized");
  } catch (outboxErr) {
    console.error("⚠️ Failed to initialize Outbox Worker:", outboxErr);
  }
}

// Graceful shutdown — drain BullMQ worker and outbox poller before process exit
// Critical on Render: prevents jobs being marked as stalled mid-execution
const gracefulShutdown = async (signal: string) => {
  console.log(`\n[${signal}] Shutting down gracefully...`);
  if (outboxWorkerInstance) {
    await outboxWorkerInstance.stop();
    console.log("✅ Outbox Worker stopped.");
  }
  if (notificationWorkerInstance) {
    await notificationWorkerInstance.close();
    console.log("✅ Notification Worker closed.");
  }
  process.exit(0);
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
