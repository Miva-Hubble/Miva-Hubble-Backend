import { prisma } from "../../lib/prisma.js";
import { DeliveryEventType, Prisma } from "@prisma/client";

// -----------------------------------------------------------------------
// Delivery-event metadata bounds
// -----------------------------------------------------------------------
//
// NotificationDeliveryEvent.metadata is Json and this table is append-only
// (one row per QUEUED/SENDING/SENT/DELIVERED/BOUNCED/FAILED/RETRYING
// transition, for every recipient, of every campaign). Nothing here today
// passes a large payload — appendDeliveryEvent is only ever called from
// notification.worker.ts with a small { error } shape — but the metadata
// parameter is typed as `Record<string, any>` with no shape enforced, and
// this is exactly the kind of column that silently becomes a storage
// problem the day a provider webhook payload (or a future provider
// integration) gets passed straight through. Capping it at the single
// write path (here) means every caller gets the protection for free,
// instead of every future caller having to remember to sanitize.
//
// This is deliberately generic (not a fixed allow-list of keys) because
// legitimate callers vary (error string today, provider webhook fields
// tomorrow) — but it enforces: only primitive values, a bounded key count,
// bounded string length per value, and a bounded total serialized size.
const MAX_DELIVERY_METADATA_KEYS = 20;
const MAX_DELIVERY_METADATA_STRING_LENGTH = 1000; // per value, chars
const MAX_DELIVERY_METADATA_BYTES = 2000; // total serialized, bytes

function sanitizeDeliveryMetadata(metadata: Record<string, any> | undefined): Prisma.InputJsonValue {
  if (!metadata || typeof metadata !== "object") return {};

  const entries = Object.entries(metadata).slice(0, MAX_DELIVERY_METADATA_KEYS);
  const bounded: Record<string, string | number | boolean | null> = {};

  for (const [key, value] of entries) {
    if (value === null || typeof value === "number" || typeof value === "boolean") {
      bounded[key] = value;
      continue;
    }
    // Anything else (string, object, array, etc.) is coerced to a
    // length-capped string rather than stored as-is. Nested
    // objects/arrays are exactly the "thousands/millions of characters of
    // debug payload" shape we're guarding against, so they're flattened
    // to a string and then truncated like everything else — never stored
    // as raw nested JSON.
    const asString = typeof value === "string" ? value : JSON.stringify(value);
    bounded[key] =
      asString.length > MAX_DELIVERY_METADATA_STRING_LENGTH
        ? `${asString.slice(0, MAX_DELIVERY_METADATA_STRING_LENGTH)}…[truncated]`
        : asString;
  }

  // Belt-and-braces on total size even after per-value truncation (e.g. 20
  // keys * 1000 chars is still ~20KB) — if the whole thing still exceeds
  // the byte budget, drop down to a minimal marker instead of storing a
  // partially-truncated-but-still-huge object.
  const serialized = JSON.stringify(bounded);
  if (Buffer.byteLength(serialized, "utf8") > MAX_DELIVERY_METADATA_BYTES) {
    return {
      truncated: true,
      originalKeyCount: Object.keys(metadata).length,
      note: "metadata exceeded storage bounds and was dropped — see application logs for the full payload if needed",
    };
  }

  return bounded as Prisma.InputJsonValue;
}

/**
 * Delivery-event appending only — the append-only audit trail table. Split
 * out from the old monolithic notification-campaign.repository.ts —
 * campaign-row CRUD and recipient eligibility/bulk-insert live in the two
 * sibling repository files.
 */
export class NotificationDeliveryRepository {
  async appendDeliveryEvent(
    recipientId: string,
    event: DeliveryEventType,
    details?: { provider?: string; providerMessageId?: string; metadata?: Record<string, any> }
  ) {
    return prisma.notificationDeliveryEvent.create({
      data: {
        notificationRecipientId: recipientId,
        event,
        provider: details?.provider,
        providerMessageId: details?.providerMessageId,
        // Bounded at the single write path so every caller (today: the
        // worker's success/failure branches; tomorrow: any new provider
        // integration) is protected without having to remember to sanitize
        // itself. See sanitizeDeliveryMetadata for the bounds.
        metadata: sanitizeDeliveryMetadata(details?.metadata),
      },
    });
  }
}

export const notificationDeliveryRepository = new NotificationDeliveryRepository();
