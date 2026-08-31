import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/user.js";
import onboardingRoutes from "./routes/onboarding.route.js";
import adminRoutes from "./routes/admin.js";
import storageRoutes from "./routes/storage.js";
import taxonomyRoutes from "./routes/taxonomy.route.js";
import feedRoutes from "./routes/feed.route.js";
import notificationRoutes from "./modules/notifications/notification.routes.js";
import { initNotificationWorker } from "./modules/notifications/notification.worker.js";
import { initOutboxWorker } from "./modules/notifications/outbox.worker.js";
import "./events/onboarding.listener.js";
import { errorHandler } from "./middleware/error.js";
// app.ts

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

const app = express();
const PORT = process.env.PORT || 7292;

// Trust the first proxy hop (Render's load balancer) so req.ip returns the
// real client IP instead of the proxy's — required for rate limiters to work.
app.set("trust proxy", 1);

// Parse allowed origins from environment variable
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",").map((o) => o.trim()) || [
  "http://localhost:3000",
];

// Middleware
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or Postman)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  }),
);
// Body size limit: prevents trivial DoS via oversized payloads.
// 1MB accommodates rich HTML email content in notification body field.
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);
app.use("/api/onboarding", onboardingRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/storage", storageRoutes);
app.use("/api/taxonomy", taxonomyRoutes);
app.use("/api/feed", feedRoutes);
app.use("/api/notifications", notificationRoutes);

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

// Health check
app.get("/", (_req, res) => {
  res.json({
    message: "Miva Hubble API",
    status: "running",
  });
});

// Health check
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "Miva Hubble API",
  });
});

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
