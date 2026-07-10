// routes/storage.ts

import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { RequestUploadUrlSchema, CreateFileSchema } from "../schemas/storage.schema.js";
import {
  getUserUploadUrl,
  registerUpload,
  listFiles,
  archiveFile,
  getPersonalizedLibrary,
  getDownloadUrl,
} from "../controller/storageController.js";

const router = Router();

router.use(authenticate);

router.post("/upload-url", validate(RequestUploadUrlSchema), getUserUploadUrl);
router.post("/", validate(CreateFileSchema), registerUpload);
router.get("/", listFiles);
router.get("/library", getPersonalizedLibrary); // Personalized user book library feed
router.get("/:id/url", getDownloadUrl);
router.delete("/:id", archiveFile);

export default router;
