import { z } from "zod";
import { DEPARTMENTS } from "../../constants/taxonomy.js";

// PATCH /api/user/department — post-onboarding department change, subject
// to a 60-day server-side cooldown (see OnboardingService.updateDepartment).
// Reuses the same DEPARTMENTS enum as onboarding.schema.ts so a value valid
// at onboarding time is always valid here too, and vice versa.
export const UpdateDepartmentSchema = z.object({
  department: z.enum(DEPARTMENTS),
});

export type UpdateDepartmentInput = z.infer<typeof UpdateDepartmentSchema>;
