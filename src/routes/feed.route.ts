// src/routes/feed.route.ts

import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { getFeedHandler } from "../controller/feedController.js";

const router = Router();

// All feed endpoints require an authenticated student session.
router.use(authenticate);

router.get("/", getFeedHandler);

export default router;
