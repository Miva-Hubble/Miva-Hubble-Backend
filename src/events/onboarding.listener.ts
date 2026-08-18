import { eventEmitter, EventPayload } from "./eventEmitter.js";
import { prisma } from "../lib/prisma.js";
import { notificationService } from "../modules/notifications/notification.service.js";
import { NotificationChannel, NotificationType } from "@prisma/client";

interface UserOnboardedPayload {
  userId: string;
  level?: string;
  department?: string;
}

eventEmitter.on("user.onboarded", async (rawEvent: EventPayload) => {
  const event = rawEvent as unknown as UserOnboardedPayload;
  if (!event.userId) {
    console.warn("[OnboardingListener] Received user.onboarded event without userId. Ignoring.");
    return;
  }

  console.log(`[OnboardingListener] User onboarded event received for userId: ${event.userId}`);

  try {
    const user = await prisma.user.findUnique({
      where: { id: event.userId },
      select: { id: true, name: true, username: true, email: true },
    });

    if (!user || !user.email) {
      console.warn(`[OnboardingListener] Cannot send welcome email: user ${event.userId} not found or has no email.`);
      return;
    }

    const displayName = user.name || user.username || "Student";
    const idempotencyKey = `WELCOME:${user.id}`;

    await notificationService.sendTransactionalNotification({
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
          <p>Your academic onboarding is complete and your student profile is now active.</p>
          <p>Here's what you can do on Miva Hubble:</p>
          <ul>
            <li><strong>Personalized Library:</strong> Discover course textbooks, past questions, and study materials curated for your level and department.</li>
            <li><strong>Private Study Storage:</strong> Upload and organize your personal academic documents securely.</li>
            <li><strong>Stay Informed:</strong> Receive official announcements, course updates, and exam schedules directly in your student feed.</li>
          </ul>
          <p>If you have any questions or need support, our team is always here to help.</p>
          <br/>
          <p style="color: #4b5563;">Best regards,<br/><strong>The Miva Hubble Team</strong></p>
        </div>
      `,
      metadata: {
        event: "user.onboarded",
        level: event.level,
        department: event.department,
        onboardedAt: new Date().toISOString(),
      },
    });

    console.log(`[OnboardingListener] Transactional welcome notification queued for user ${user.id} (${user.email})`);
  } catch (err: any) {
    console.error(`[OnboardingListener] Failed to process onboarding welcome notification for user ${event.userId}:`, err);
  }
});
