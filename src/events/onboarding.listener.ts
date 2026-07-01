import { eventEmitter, EventPayload } from "./eventEmitter.js";

eventEmitter.on("user.onboarded", async (event: EventPayload) => {
  console.log("User onboarded:", event);

  /**
   * Future features
   */

  // Send welcome notification

  // Award badge

  // Generate recommendations

  // Log analytics

  // Queue email

  // Create activity log
});
