import { Router } from "express";
import { getCurrentUser } from "../controller/userController.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

router.get("/me", authenticate, getCurrentUser);

export default router;
