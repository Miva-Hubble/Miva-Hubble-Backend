// controller/studentResourceController.ts

import { Response } from "express";
import { AuthRequest } from "../middleware/auth.js";
import { AdminAuthRequest } from "../middleware/adminAuth.js";
import { StudentResourceService } from "../services/studentResourceService.js";
import { ProgressionService } from "../services/progressionService.js";
import { HttpStatus } from "../utils/httpStatus.js";
import {
  RequestStudentResourceUploadUrlInput,
  ResourceIdParamSchema,
  AdminListStudentResourcesQuerySchema,
  AdminReviewStudentResourceSchema,
  AdminReviewStudentResourceInput,
  AdminArchiveStudentResourceSchema,
  AdminArchiveStudentResourceInput,
  VaultQuerySchema,
  VaultResourceUrlQuerySchema,
  MyStudentResourcesQuerySchema,
} from "../schemas/studentResource.schema.js";

export const getStudentResourceUploadUrl = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ error: "Unauthorized" });
    }

    const { filename, contentType, sizeBytes } = req.body as RequestStudentResourceUploadUrlInput;
    const upload = await StudentResourceService.createUploadUrl(userId, filename, contentType, sizeBytes);

    return res.status(HttpStatus.OK).json({ success: true, ...upload });
  } catch (error: any) {
    console.error("Get student resource upload URL error:", error);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: error.message || "Failed to create upload URL",
    });
  }
};

export const createStudentResource = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ error: "Unauthorized" });
    }

    const resource = await StudentResourceService.createDraft(userId, req.body);
    return res.status(HttpStatus.CREATED).json({ success: true, resource: StudentResourceService.toPublicResource(resource) });
  } catch (error: any) {
    console.error("Create student resource error:", error);
    return res.status(HttpStatus.BAD_REQUEST).json({
      error: error.message || "Failed to create student resource",
    });
  }
};

export const submitStudentResource = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ error: "Unauthorized" });
    }

    const paramResult = ResourceIdParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        error: "Validation failed",
        errors: paramResult.error.flatten(),
      });
    }

    const resource = await StudentResourceService.submitResource(userId, paramResult.data.id);
    return res.status(HttpStatus.OK).json({ success: true, resource: StudentResourceService.toPublicResource(resource) });
  } catch (error: any) {
    console.error("Submit student resource error:", error);
    const isNotFound = error.message?.includes("not found") || error.message?.includes("unauthorized");
    return res.status(isNotFound ? HttpStatus.NOT_FOUND : HttpStatus.BAD_REQUEST).json({
      error: error.message || "Failed to submit student resource",
    });
  }
};

// ---------------------------------------------------------------------------
// Student progress read (Gate 9)
// ---------------------------------------------------------------------------

// getStudentProgress always derives userId from the verified access token
// (req.user.userId, set by the `authenticate` middleware) and never from
// req.params/req.query/req.body — there is no route parameter or query
// field for it to read in the first place, which is what makes a student
// reading another user's progress structurally impossible here, not just
// something the handler happens not to do.
export const getStudentProgress = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ error: "Unauthorized" });
    }

    const progress = await ProgressionService.getStudentProgress(userId);
    return res.status(HttpStatus.OK).json({ success: true, ...progress });
  } catch (error: any) {
    console.error("Get student progress error:", error);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: error.message || "Failed to load progress",
    });
  }
};

// ---------------------------------------------------------------------------
// Admin moderation handlers (Gate 7)
// ---------------------------------------------------------------------------

export const adminListStudentResources = async (req: AdminAuthRequest, res: Response) => {
  try {
    const adminId = req.admin?.adminId;
    if (!adminId) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ error: "Unauthorized" });
    }

    const queryResult = AdminListStudentResourcesQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        error: "Validation failed",
        errors: queryResult.error.flatten(),
      });
    }

    const { status, page, limit } = queryResult.data;
    const result = await StudentResourceService.listResources(status, page, limit);

    return res.status(HttpStatus.OK).json({
      success: true,
      ...result,
      resources: result.resources.map((r) => StudentResourceService.toPublicResource(r)),
    });
  } catch (error: any) {
    console.error("Admin list student resources error:", error);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: error.message || "Failed to list student resources",
    });
  }
};

export const adminReviewStudentResource = async (req: AdminAuthRequest, res: Response) => {
  try {
    const adminId = req.admin?.adminId;
    if (!adminId) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ error: "Unauthorized" });
    }

    const paramResult = ResourceIdParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        error: "Validation failed",
        errors: paramResult.error.flatten(),
      });
    }

    const bodyResult = AdminReviewStudentResourceSchema.safeParse(req.body);
    if (!bodyResult.success) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        error: "Validation failed",
        errors: bodyResult.error.flatten(),
      });
    }

    const { action, reason } = bodyResult.data;
    const resource = await StudentResourceService.reviewResource(
      adminId,
      paramResult.data.id,
      action,
      reason
    );

    return res.status(HttpStatus.OK).json({ success: true, resource: StudentResourceService.toPublicResource(resource) });
  } catch (error: any) {
    console.error("Admin review student resource error:", error);
    const isNotFound = error.message?.includes("not found");
    const isConflict =
      error.message?.includes("already been approved") || error.message?.includes("Only PENDING_REVIEW");
    const status = isNotFound ? HttpStatus.NOT_FOUND : isConflict ? HttpStatus.CONFLICT : HttpStatus.BAD_REQUEST;

    return res.status(status).json({
      error: error.message || "Failed to review student resource",
    });
  }
};

// ---------------------------------------------------------------------------
// Gate 12 — Vault (student-facing discovery + signed access)
// ---------------------------------------------------------------------------

export const getVault = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ error: "Unauthorized" });
    }

    const queryResult = VaultQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        error: "Validation failed",
        errors: queryResult.error.flatten(),
      });
    }

    const result = await StudentResourceService.listVaultResources(userId, queryResult.data);

    return res.status(HttpStatus.OK).json({
      success: true,
      ...result,
      resources: result.resources.map((r) => StudentResourceService.toPublicResource(r)),
    });
  } catch (error: any) {
    console.error("Get vault error:", error);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: error.message || "Failed to load vault",
    });
  }
};

// Ineligible/nonexistent resources both return 404 with the same message —
// never 403 — so a student can't distinguish "doesn't exist" from "exists
// but isn't eligible for you", matching GET /api/notifications/:id.
export const getVaultResourceUrl = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ error: "Unauthorized" });
    }

    const paramResult = ResourceIdParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        error: "Validation failed",
        errors: paramResult.error.flatten(),
      });
    }

    const queryResult = VaultResourceUrlQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        error: "Validation failed",
        errors: queryResult.error.flatten(),
      });
    }

    const signedUrl = await StudentResourceService.getVaultResourceSignedUrl(
      userId,
      paramResult.data.id,
      queryResult.data.mode
    );

    return res.status(HttpStatus.OK).json({ success: true, signedUrl });
  } catch (error: any) {
    console.error("Get vault resource URL error:", error);
    const isNotFound = error.message?.includes("not found");
    return res.status(isNotFound ? HttpStatus.NOT_FOUND : HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: isNotFound ? "Resource not found" : error.message || "Failed to generate signed URL",
    });
  }
};

// GET /api/student-resources/mine — ownership-based, every status,
// includes rejectionReason. userId always from the token, never a param.
export const getMyStudentResources = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ error: "Unauthorized" });
    }

    const queryResult = MyStudentResourcesQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        error: "Validation failed",
        errors: queryResult.error.flatten(),
      });
    }

    const resources = await StudentResourceService.listMyResources(userId, queryResult.data.status);

    return res.status(HttpStatus.OK).json({
      success: true,
      resources: resources.map((r) => StudentResourceService.toPublicResource(r)),
    });
  } catch (error: any) {
    console.error("Get my student resources error:", error);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: error.message || "Failed to load your resources",
    });
  }
};

export const adminArchiveStudentResource = async (req: AdminAuthRequest, res: Response) => {
  try {
    const adminId = req.admin?.adminId;
    if (!adminId) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ error: "Unauthorized" });
    }

    const paramResult = ResourceIdParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        error: "Validation failed",
        errors: paramResult.error.flatten(),
      });
    }

    const bodyResult = AdminArchiveStudentResourceSchema.safeParse(req.body || {});
    if (!bodyResult.success) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        error: "Validation failed",
        errors: bodyResult.error.flatten(),
      });
    }

    const resource = await StudentResourceService.archiveResource(
      paramResult.data.id,
      bodyResult.data.reason
    );

    return res.status(HttpStatus.OK).json({ success: true, resource: StudentResourceService.toPublicResource(resource) });
  } catch (error: any) {
    console.error("Admin archive student resource error:", error);
    const isNotFound = error.message?.includes("not found");
    const status = isNotFound ? HttpStatus.NOT_FOUND : HttpStatus.BAD_REQUEST;

    return res.status(status).json({
      error: error.message || "Failed to archive student resource",
    });
  }
};

export const getAdminStudentResourcePreviewUrl = async (req: AdminAuthRequest, res: Response) => {
  try {
    const adminId = req.admin?.adminId;
    if (!adminId) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ error: "Unauthorized" });
    }

    const resourceId = (req.params.resourceId || req.params.id) as string;
    const paramResult = ResourceIdParamSchema.safeParse({ id: resourceId });
    if (!paramResult.success) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        error: "Resource ID must be a valid UUID",
        errors: paramResult.error.flatten(),
      });
    }

    const result = await StudentResourceService.getAdminResourcePreviewUrl(paramResult.data.id, 3600);

    return res.status(HttpStatus.OK).json({
      success: true,
      signedUrl: result.signedUrl,
      expiresIn: result.expiresIn,
    });
  } catch (error: any) {
    console.error("Get admin student resource preview URL error:", error);
    const isNotFound = error.message?.includes("not found");
    return res.status(isNotFound ? HttpStatus.NOT_FOUND : HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: error.message || "Failed to generate preview URL",
    });
  }
};


