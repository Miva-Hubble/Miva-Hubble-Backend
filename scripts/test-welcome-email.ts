import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import { notificationService } from "../src/modules/notifications/notification.service.js";
import { NotificationChannel, NotificationType } from "@prisma/client";

const to = process.argv[2] || process.env.TEST_EMAIL;

if (!to) {
  console.error("Usage: pnpm exec tsx scripts/test-welcome-email.ts your@email.com");
  console.error("  (or set TEST_EMAIL in .env)");
  process.exit(1);
}

const from =
  process.env.RESEND_FROM_EMAIL || process.env.FROM_EMAIL || "Miva Hubble <onboarding@resend.dev>";

console.log("\nWelcome email test");
console.log("  To:   ", to);
console.log("  From: ", from);
console.log("  Redis:", process.env.UPSTASH_REDIS_URL ? "configured" : "MISSING");
console.log("  Resend API key:", process.env.RESEND_API_KEY ? "configured" : "MISSING");
console.log("");

if (!process.env.RESEND_API_KEY) {
  console.error("RESEND_API_KEY is not set.");
  process.exit(1);
}

if (!process.env.UPSTASH_REDIS_URL && !process.env.REDIS_URL) {
  console.error("UPSTASH_REDIS_URL (or REDIS_URL) is not set — workers cannot deliver.");
  process.exit(1);
}

const user = await prisma.user.findFirst({
  where: { email: to },
  select: { id: true, email: true, name: true, username: true },
});

if (!user) {
  console.error(`No user in the database with email "${to}".`);
  console.error("Register on the app with this exact email first (must match your Resend account for sandbox).");
  process.exit(1);
}

const displayName = user.name || user.username || "Student";
const idempotencyKey = `WELCOME-TEST:${Date.now()}`;

const result = await notificationService.sendTransactionalNotification({
  userId: user.id,
  email: user.email,
  type: NotificationType.TRANSACTIONAL,
  channel: NotificationChannel.EMAIL,
  idempotencyKey,
  title: "Welcome to Miva Hubble!",
  subject: "Welcome to Miva Hubble — Your Academic Hub",
  message: `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #2563eb;">Welcome to Miva Hubble, ${displayName}! 🎓</h2>
      <p><strong>Test email</strong> — your welcome notification pipeline is working.</p>
      <p>If you received this, Resend + Redis + workers are configured correctly.</p>
      <br/>
      <p style="color: #4b5563;">Best regards,<br/><strong>The Miva Hubble Team</strong></p>
    </div>
  `,
  metadata: { event: "welcome.test", at: new Date().toISOString() },
});

console.log("Queued:", result);
console.log("");
console.log("Wait ~5–10 seconds, then check your inbox (and spam).");
console.log("On Render, confirm logs show OutboxWorker + NotificationWorker activity.");
console.log("");

await prisma.$disconnect();
