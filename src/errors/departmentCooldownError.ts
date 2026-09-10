/**
 * Thrown by OnboardingService.updateDepartment when a student attempts to
 * change their department before the 60-day cooldown (departmentChangedAt)
 * has elapsed. Mirrors UsernameTakenError's shape (status + kept-distinct
 * class, not a generic thrown string) so the controller can pattern-match
 * on `error.name` the same way userController already does for
 * UsernameTakenError.
 *
 * Deliberately 409 Conflict, not 429 Too Many Requests: this isn't a rate
 * limit on request frequency, it's a business-rule conflict between "what
 * you're asking for" and "the current state of your account" — and 409 is
 * the one status getUserFriendlyError's status map (frontend) already
 * prefers the backend's own `message` for, so the exact days-remaining
 * text reaches the user without any frontend changes to that map.
 */
export class DepartmentCooldownError extends Error {
  status = 409;
  availableAt: Date;
  daysRemaining: number;

  constructor(availableAt: Date, daysRemaining: number) {
    super(
      `You can change your department again in ${daysRemaining} day${
        daysRemaining === 1 ? "" : "s"
      } (from ${availableAt.toISOString().slice(0, 10)}).`,
    );
    this.name = "DepartmentCooldownError";
    this.availableAt = availableAt;
    this.daysRemaining = daysRemaining;
  }
}
