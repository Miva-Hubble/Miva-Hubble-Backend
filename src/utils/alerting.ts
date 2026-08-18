/**
 * Minimal ops-alert sink — posts a message to a Slack/Discord-compatible
 * incoming webhook (both accept `{ text }` as the entire payload shape) when
 * ALERT_WEBHOOK_URL is configured.
 *
 * This exists to close the "silent failure sink" gap in the notification
 * engine: without it, a batch that exhausts all BullMQ retries, or a
 * campaign that finishes with a high partial-failure rate, was only ever
 * visible in console.error output and DB rows — invisible to anyone not
 * actively tailing logs or querying recipient status. During a Resend
 * outage or domain block this meant an admin got a 202 on campaign
 * creation and had no way to find out delivery was failing en masse until
 * students reported it.
 *
 * Deliberately provider-agnostic (no @slack/webhook or discord.js
 * dependency) since both Slack and Discord incoming webhooks accept the
 * same `{ text }` POST body — swap in a richer payload later if a specific
 * provider's block-kit/embeds are wanted.
 *
 * Best-effort only: a failed alert delivery is logged and swallowed, never
 * thrown — alerting must never be what takes down a worker or blocks a
 * campaign from reaching a terminal status.
 */
const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL;

export async function sendOpsAlert(title: string, context?: Record<string, unknown>): Promise<void> {
  const lines = [`🚨 ${title}`];
  if (context) {
    for (const [key, value] of Object.entries(context)) {
      lines.push(`• ${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
    }
  }
  const text = lines.join("\n");

  if (!ALERT_WEBHOOK_URL) {
    // No sink configured — still strictly better than the old
    // console.error-only path: it's one well-known place to grep, and it's
    // exactly what tells whoever's setting up alerting for the first time
    // which env var to set.
    console.error(`[OpsAlert] ${text}\n[OpsAlert] (ALERT_WEBHOOK_URL not configured — alert not delivered externally)`);
    return;
  }

  try {
    const res = await fetch(ALERT_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      console.error(`[OpsAlert] Webhook responded with ${res.status} ${res.statusText}`);
    }
  } catch (err: any) {
    console.error(`[OpsAlert] Failed to deliver alert to webhook:`, err?.message || err);
  }
}
