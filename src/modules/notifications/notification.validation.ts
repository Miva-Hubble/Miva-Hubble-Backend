import { z } from "zod";
import sanitizeHtml from "sanitize-html";
import { TARGET_ALL } from "./notification.types.js";

// Admin-authored notification bodies are rendered as raw HTML in the
// recipient's inbox (see providers/email/resend.provider.ts). Without
// sanitization, a compromised or rogue admin account can inject scripts,
// iframes, or tracking payloads. This is a conservative allow-list (not a
// deny-list) — anything not explicitly permitted is stripped by default.
// Loosen only for a specific, deliberate formatting need.
// (Phase 0 QA report, Critical #3)
const NOTIFICATION_BODY_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "b", "strong", "i", "em", "u",
    "h1", "h2", "h3", "h4",
    "ul", "ol", "li",
    "a", "img",
    "blockquote",
    "table", "thead", "tbody", "tr", "td", "th",
  ],
  allowedAttributes: {
    a: ["href", "target", "rel"],
    img: ["src", "alt", "width", "height"],
  },
  // No inline `style` support for now — keeps CSS-based abuse (expression
  // tricks, tracking pixels via background-image, layout hijacking) closed.
  // Add it back explicitly, scoped to a safe property allow-list, if admins
  // need richer formatting later.
  allowedSchemes: ["http", "https", "mailto"],
};

// Bounds for the `metadata` field (Phase 0 QA report, Medium #7). Restricting
// values to primitives (no nested objects/arrays) caps depth at one level by
// construction; the two refinements below cap breadth and total payload size.
const MAX_METADATA_KEYS = 20;
const MAX_METADATA_BYTES = 10_000; // 10KB serialized

// `TARGET_ALL` ("All") means "every level" / "every department" — see
// notification-campaign.repository.ts for how it's resolved. It must be
// sent alone: mixing it with specific values (e.g. ["All", "Level200"]) is
// ambiguous — is that a typo, or intentionally "everyone, especially
// Level200"? — so we reject it here rather than guess.
const targetArray = (label: string) =>
  z
    .array(z.string())
    .min(1, `At least one target ${label} is required`)
    .refine((arr) => !(arr.includes(TARGET_ALL) && arr.length > 1), {
      message: `"${TARGET_ALL}" cannot be combined with specific ${label}s — send ["${TARGET_ALL}"] alone to target every ${label}.`,
    });

export const createNotificationSchema = z.object({
  targetLevels: targetArray("level"),
  // Not currently exposed in the admin UI (level checkboxes only, see Phase 1
  // discussion) — accepted here so the schema doesn't need to change again
  // once department targeting is added. Defaults explicitly to [TARGET_ALL]
  // when omitted, mirroring Book.department's "All" sentinel convention
  // (see StorageService.getPersonalizedFeed) — an omitted field and an
  // explicit ["All"] must be indistinguishable to every downstream
  // consumer (repository targeting query, campaign row, admin UI
  // rendering it back), so the default is stamped in here rather than left
  // as an empty array that repository code has to separately special-case.
  targetDepartments: z
    .array(z.string())
    .optional()
    .default([TARGET_ALL])
    .refine((arr) => !(arr.includes(TARGET_ALL) && arr.length > 1), {
      message: `"${TARGET_ALL}" cannot be combined with specific departments — send ["${TARGET_ALL}"] alone to target every department.`,
    }),
  // Renamed from `subject`/`body` to `title`/`message` to match the
  // NotificationCampaign model's field names directly (schema.prisma) —
  // no more silent subject→title mapping in the service layer to keep
  // track of. `title` is both the campaign's admin-facing name AND the
  // email subject line today (NotificationCampaign has no separate
  // subject-line field exposed here — see service.ts's dispatchNotification
  // comment); `message` is the HTML body.
  title: z.string().min(1, "Title is required").max(200, "Title is too long (max 200 characters)"),
  message: z
    .string()
    .min(1, "Notification message is required")
    // Sanitize at the validation boundary so the stored DB record, the
    // queued BullMQ job, and the delivered email are all the same clean
    // HTML — one point of truth instead of trusting every downstream
    // consumer (worker, provider) to sanitize independently.
    .transform((val) => sanitizeHtml(val, NOTIFICATION_BODY_SANITIZE_OPTIONS)),
  // `userId` is intentionally NOT accepted from the client (Phase 0 QA
  // report, Medium #9) — recipients are resolved server-side from
  // targetLevels via notification-recipient.repository.ts.
  // `channel` is also intentionally not accepted: NotificationCampaign has
  // no column for it, and the worker only ever sends email today (IN_APP
  // was never implemented) — accepting a value that's silently discarded
  // would be misleading.
  metadata: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional()
    .default({})
    .refine((obj) => Object.keys(obj).length <= MAX_METADATA_KEYS, {
      message: `metadata cannot have more than ${MAX_METADATA_KEYS} keys`,
    })
    .refine((obj) => JSON.stringify(obj).length <= MAX_METADATA_BYTES, {
      message: `metadata payload too large (max ${MAX_METADATA_BYTES} bytes serialized)`,
    }),
});

export const notificationIdParamSchema = z.object({
  id: z.string().uuid("Invalid notification ID format"),
});

export type CreateNotificationInput = z.infer<typeof createNotificationSchema>;
