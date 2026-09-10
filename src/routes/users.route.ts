import { Router } from "express";
import { checkUsername } from "../controller/userController.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

// GET /api/users/check-username?username=... — auth required, no anonymous
// username enumeration.
router.get("/check-username", authenticate, checkUsername);

export default router;
