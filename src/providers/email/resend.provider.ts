import { Resend } from "resend";
import { IEmailProvider, SendEmailOptions, SendEmailResult } from "./email.provider.js";

const DEFAULT_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || process.env.FROM_EMAIL || "Miva Hubble <onboarding@resend.dev>";

// Resend's error `name` values that mean "this exact request will never
// succeed, no matter how many times it's retried" — bad input, auth/config
// problems, or an address Resend itself rejects. Per
// https://resend.com/docs/api-reference/errors. Anything NOT in this set
// (rate limits, 5xx, network errors, or an error shape Resend changes in
// the future) is treated as transient and retried — the safe default,
// since wrongly calling a transient error "permanent" would silently drop
// a delivery that a retry could have saved.
const PERMANENT_RESEND_ERROR_NAMES = new Set([
  "validation_error",
  "missing_required_field",
  "invalid_idempotency_key",
  "invalid_attachment",
  "invalid_from_address",
  "invalid_access",
  "invalid_parameter",
  "invalid_region",
  "missing_api_key",
  "invalid_api_key",
  "restricted_api_key",
  "not_found",
  "method_not_allowed",
  "security_error",
]);

function classifyResendError(errorName: string | undefined): "permanent" | "transient" {
  return errorName && PERMANENT_RESEND_ERROR_NAMES.has(errorName) ? "permanent" : "transient";
}

export class ResendProvider implements IEmailProvider {
  private resend: Resend;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.RESEND_API_KEY;
    if (!key) {
      console.warn("⚠️ RESEND_API_KEY is not set in environment variables. Resend email dispatches will fail in runtime.");
    }
    this.resend = new Resend(key || "re_dummy_key_for_init");
  }

  async sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
    try {
      const from = options.from || DEFAULT_FROM_EMAIL;
      const { data, error } = await this.resend.emails.send({
        from,
        to: Array.isArray(options.to) ? options.to : [options.to],
        subject: options.subject,
        html: options.html,
        text: options.text,
      });

      if (error) {
        return {
          id: "",
          success: false,
          error: error.message,
          errorType: classifyResendError((error as any).name),
        };
      }

      return {
        id: data?.id || "",
        success: true,
      };
    } catch (err: any) {
      // Thrown errors here are network/SDK-level (timeouts, DNS, connection
      // resets) rather than Resend API-rejection errors — always transient.
      return {
        id: "",
        success: false,
        error: err?.message || "Unknown error during Resend email dispatch",
        errorType: "transient",
      };
    }
  }
}
