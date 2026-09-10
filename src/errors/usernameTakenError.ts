/**
 * Thrown whenever a username-claiming write hits a uniqueness conflict —
 * onboarding (2.3), PATCH /api/user/username (3.2). Kept as a single
 * shared class specifically so it never collapses into a generic 409 next
 * to unrelated ones (e.g. "User has already completed onboarding"): the
 * two must stay distinguishable — one means "you're done, redirecting,"
 * the other means "pick another name."
 */
export class UsernameTakenError extends Error {
  status = 409;

  constructor(message = "Username is already taken") {
    super(message);
    this.name = "UsernameTakenError";
  }
}
