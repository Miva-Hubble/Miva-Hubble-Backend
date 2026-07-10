// routes/admin.ts

import { Router } from "express";
import { adminLogin, adminRefreshToken, adminLogout, getCurrentAdmin } from "../controller/adminAuthController.js";
import {
  getAdminBookUploadUrl,
  adminCreateBook,
  adminListBooks,
  adminUpdateBook,
  adminDeleteBook,
} from "../controller/storageController.js";
import { validate } from "../middleware/validate.js";
import { AdminLoginSchema } from "../schemas/admin.schema.js";
import { RequestUploadUrlSchema, CreateBookSchema, UpdateBookSchema } from "../schemas/storage.schema.js";
import { authenticateAdmin } from "../middleware/adminAuth.js";

const router = Router();

router.post("/auth/login", validate(AdminLoginSchema), adminLogin);
router.post("/auth/refresh", adminRefreshToken);
router.post("/auth/logout", adminLogout);
router.get("/auth/me", authenticateAdmin, getCurrentAdmin);

// Library book management — everything below requires an active admin session
router.post("/storage/books/upload-url", authenticateAdmin, validate(RequestUploadUrlSchema), getAdminBookUploadUrl);
router.post("/storage/books", authenticateAdmin, validate(CreateBookSchema), adminCreateBook);
router.get("/storage/books", authenticateAdmin, adminListBooks);
router.patch("/storage/books/:id", authenticateAdmin, validate(UpdateBookSchema), adminUpdateBook);
router.delete("/storage/books/:id", authenticateAdmin, adminDeleteBook);

export default router;
