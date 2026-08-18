export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

export interface SendEmailResult {
  id: string;
  success: boolean;
  error?: string;
  // "permanent": retrying with the same input will never succeed (bad
  // email address, validation error, auth/config error) — a caller should
  // record the failure and stop, not spend retry attempts on it.
  // "transient": a retry might succeed (rate limit, provider 5xx, network
  // blip). Omitted (e.g. on success, or if the provider can't classify the
  // error) is treated as transient by callers — the safe default is to
  // retry rather than silently give up on an unclassified error.
  errorType?: "permanent" | "transient";
}

export interface IEmailProvider {
  sendEmail(options: SendEmailOptions): Promise<SendEmailResult>;
}
