import { notificationCampaignRepository } from "./notification-campaign.repository.js";
import { notificationRecipientRepository } from "./notification-recipient.repository.js";

/**
 * Unified repository facade for backward compatibility.
 * Broadcast and Transactional notifications are now canonically managed by
 * NotificationCampaignRepository and NotificationRecipientRepository.
 */
export const notificationRepository = {
  findById: (id: string) => notificationRecipientRepository.findById(id),
  findByUserId: (userId: string, limit = 20) => notificationRecipientRepository.findByUserId(userId, limit),
  findCampaignById: (id: string) => notificationCampaignRepository.findById(id),
};
