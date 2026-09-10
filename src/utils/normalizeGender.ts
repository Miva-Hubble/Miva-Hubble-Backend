import { Gender } from "@prisma/client";

/**
 * Single point of truth for converting the Prisma `Gender` enum
 * (`MALE` | `FEMALE`) into the lowercase shape the frontend type
 * (`types/user.ts`) and `lib/avatar/getAvatarAsset.ts` expect.
 *
 * GET /api/user/me (userService.getUserProfile) and POST /api/onboarding
 * (onboardController.completeOnboarding) both call this — never
 * re-lowercase inline in either place, or the two will drift again exactly
 * like they did before this existed.
 */
export function normalizeGender(gender: Gender | string | null | undefined): "male" | "female" | null {
  if (!gender) return null;
  return gender.toLowerCase() as "male" | "female";
}

/**
 * The inverse: converts the lowercase value validated by genderValueSchema
 * (onboarding, PATCH /api/user/identity) into the Prisma `Gender` enum for
 * writes. Single source of truth for this direction too — was previously
 * a private `toGender` inside onboardingService.ts; claimIdentity
 * (userService.ts) needs the exact same mapping, so it lives here now.
 */
export function toPrismaGender(gender: "male" | "female"): Gender {
  return gender === "male" ? Gender.MALE : Gender.FEMALE;
}
