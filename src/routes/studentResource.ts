// routes/studentResource.ts

import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  RequestStudentResourceUploadUrlSchema,
  CreateStudentResourceSchema,
} from "../schemas/studentResource.schema.js";
import {
  getStudentResourceUploadUrl,
  createStudentResource,
  submitStudentResource,
  getStudentProgress,
  getMyStudentResources,
} from "../controller/studentResourceController.js";

const router = Router();

router.use(authenticate);

router.post("/upload-url", validate(RequestStudentResourceUploadUrlSchema), getStudentResourceUploadUrl);
router.post("/", validate(CreateStudentResourceSchema), createStudentResource);
router.post("/:id/submit", submitStudentResource);

// Gate 9 — authenticated student's own progress. Deliberately no :id/param
// variant: userId always comes from the verified token, never the URL.
router.get("/progress", getStudentProgress);

// Gate 12 — the caller's own submissions across every status (including
// DRAFT/REJECTED/ARCHIVED, which never appear in /api/vault). Same no-param
// rule as /progress: userId always comes from the token.
router.get("/mine", getMyStudentResources);

export default router;
