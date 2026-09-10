import { Router } from "express";
import { getCurrentUser, patchUsername, patchIdentity, patchDepartment } from "../controller/userController.js";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { UpdateUsernameSchema } from "../schemas/validations/username.schema.js";
import { ClaimIdentitySchema } from "../schemas/validations/identity.schema.js";
import { UpdateDepartmentSchema } from "../schemas/validations/department.schema.js";

const router = Router();

router.get("/me", authenticate, getCurrentUser);
router.patch("/username", authenticate, validate(UpdateUsernameSchema), patchUsername);
router.patch("/identity", authenticate, validate(ClaimIdentitySchema), patchIdentity);
router.patch("/department", authenticate, validate(UpdateDepartmentSchema), patchDepartment);

export default router;
