import { z } from "zod";

// Single shared fragment — mirrors usernameValueSchema's role. Used by
// onboarding (2.1) and PATCH /api/user/identity (8.x, claim-identity for
// legacy pre-migration accounts). Never redefine this enum anywhere else;
// import this instead.
//
// "male" | "female" only, matching the Prisma `Gender` enum (MALE | FEMALE
// — no OTHER). The frontend's Step3UsernameAndGender component previously
// offered a third "other" option with no backing DB value; that option was
// removed from the UI (types/ProfileSetup.ts's Gender type) to match this
// schema rather than the other way around — see chat history for the
// decision.
export const genderValueSchema = z.enum(["male", "female"]);

export type GenderValue = z.infer<typeof genderValueSchema>;
