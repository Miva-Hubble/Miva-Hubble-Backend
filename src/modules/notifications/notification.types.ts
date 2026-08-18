import { NotificationChannel, NotificationStatus, NotificationType } from "@prisma/client";

export { NotificationChannel, NotificationStatus, NotificationType };

// Sentinel value for `targetLevels`/`targetDepartments` meaning "every
// level" / "every department" — mirrors the existing `level: "All"` /
// `department: "All"` wildcard convention already used on Book targeting
// (see StorageService.getPersonalizedFeed). Must be the ONLY entry in the
// array when used (enforced in notification.validation.ts) — mixing it with
// specific levels/departments is ambiguous admin intent, not a superset.
export const TARGET_ALL = "All";

// Recipients per BullMQ job. Shared by notification.service.ts
// (initial chunking) and background workers so both paths stay in lockstep.
export const NOTIFICATION_BATCH_SIZE = 100;

// Queue priority levels (BullMQ: lower numeric value = higher priority)
export const QUEUE_PRIORITY_TRANSACTIONAL = 1;
export const QUEUE_PRIORITY_BROADCAST = 10;

// Prefix stamped onto NotificationRecipient.lastError when a failure was
// classified "permanent" (see IEmailProvider.SendEmailResult.errorType) —
// e.g. Resend rejecting an invalid address with a 400.
export const PERMANENT_FAILURE_MARKER = "[PERMANENT]";

export interface CreateNotificationDTO {
  targetLevels: string[];
  targetDepartments?: string[];
  title: string;
  message: string;
  metadata?: Record<string, any>;
  createdByAdminId?: string;
}

export interface SendTransactionalNotificationDTO {
  userId: string;
  email: string;
  title: string;
  message: string;
  subject?: string;
  type?: NotificationType;
  channel?: NotificationChannel;
  idempotencyKey?: string;
  metadata?: Record<string, any>;
}

// One entry per student within a batched delivery job
export interface NotificationBatchRecipient {
  recipientId: string;
  recipient: string; // delivery email address
  userId?: string;
}

export interface NotificationJobData {
  campaignId: string;
  recipients: NotificationBatchRecipient[];
  subject: string;
  body: string;
  channel?: NotificationChannel;
  metadata?: Record<string, any>;
  priority?: number;
}

export interface NotificationResponseDTO {
  id: string;
  recipient: string;
  subject: string;
  status: NotificationStatus;
  channel: NotificationChannel;
  attempts: number;
  lastError?: string | null;
  createdAt: Date;
  updatedAt: Date;
}
