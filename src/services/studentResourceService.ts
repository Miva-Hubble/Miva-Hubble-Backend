// services/studentResourceService.ts

import { randomUUID } from "crypto";
import prisma from "../lib/prisma.js";
import { supabaseAdmin } from "../config/supabase.js";
import { StudentResourceStatus, StudentResourceType, FileFormat, Prisma } from "@prisma/client";
import type { CreateStudentResourceInput, VaultQueryInput } from "../schemas/studentResource.schema.js";
import { ALLOWED_UPLOAD_MIME_TYPES, MAX_UPLOAD_SIZE_BYTES } from "../schemas/storage.schema.js";
import { getLagosDayBounds, getLagosCalendarDate } from "../lib/lagosTime.js";
import { ProgressionService } from "./progressionService.js";

// Re-exported for backward compatibility — nothing outside this file
// currently imports these, but they used to live here (Gate 6), and moving
// them to lib/lagosTime.ts (Gate 8, to avoid a circular import with
// ProgressionService) shouldn't silently break an external import.
export { getLagosDayBounds, getLagosCalendarDate };

const EXTENSION_TO_FILE_FORMAT: Record<string, FileFormat> = {
  pdf: FileFormat.PDF,
  epub: FileFormat.EPUB,
  doc: FileFormat.DOC,
  docx: FileFormat.DOCX,
};

const BUCKET = process.env.SUPABASE_STUDENT_RESOURCES_BUCKET || "student-resources";
const STUDENT_RESOURCES_PREFIX = (userId: string) => `student-resources/${userId}/`;

// Same TTL policy as StorageService.generatePresignedUrl, for consistency
// between the two signed-URL surfaces in this codebase: preview needs to
// survive a full PDF/EPUB load, download only needs to survive the browser
// starting the pull.
const VAULT_PREVIEW_URL_TTL_SECONDS = 300;
const VAULT_DOWNLOAD_URL_TTL_SECONDS = 120;

export class StudentResourceService {
  /**
   * Issues a Supabase signed upload URL for a student academic resource.
   * Enforces server-side generated paths under `student-resources/{authenticatedUserId}/`.
   * Accepts and preserves validated upload metadata.
   */
  static async createUploadUrl(
    userId: string,
    filename: string,
    contentType: (typeof ALLOWED_UPLOAD_MIME_TYPES)[number],
    sizeBytes: number
  ) {
    const sanitizedFilename = filename.replace(/[\\/]/g, "_");
    const path = `${STUDENT_RESOURCES_PREFIX(userId)}${randomUUID()}_${sanitizedFilename}`;

    const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUploadUrl(path);

    if (error || !data) {
      throw new Error(error?.message || "Failed to create upload URL");
    }

    return {
      signedUrl: data.signedUrl,
      token: data.token,
      path,
      contentType,
      sizeBytes,
    };
  }

  /**
   * Resolves the storageObjectId and physical metadata from storage.objects table.
   */
  private static async resolveObjectAndVerifyMetadata(path: string): Promise<{
    storageObjectId: string;
    metadata: { size?: number; mimetype?: string; contentType?: string } | null;
  } | null> {
    const rows = await prisma.$queryRaw<Array<{ id: string; metadata: any }>>`
      SELECT id, metadata FROM storage.objects WHERE bucket_id = ${BUCKET} AND name = ${path} LIMIT 1
    `;
    if (!rows[0]) return null;

    return {
      storageObjectId: rows[0].id,
      metadata: (rows[0].metadata as any) ?? null,
    };
  }

  /**
   * Derives FileFormat from the extension on a server-generated storage path.
   */
  private static deriveFileFormat(path: string): FileFormat {
    const match = /\.([a-zA-Z0-9]+)$/.exec(path);
    const extension = match?.[1]?.toLowerCase();
    const format = extension ? EXTENSION_TO_FILE_FORMAT[extension] : undefined;
    if (!format) {
      throw new Error(`Unable to determine file format for upload path: ${path}`);
    }
    return format;
  }

  /**
   * Executes a transaction with Serializable isolation level, retrying on serialization conflicts (P2034).
   */
  private static async runSerializableTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    maxRetries = 3
  ): Promise<T> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await prisma.$transaction(fn, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5000,
          timeout: 10000,
        });
      } catch (err: any) {
        const isSerializationFailure =
          err.code === "P2034" ||
          err.message?.includes("could not serialize access") ||
          err.message?.includes("serialization failure");

        if (isSerializationFailure && attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 50 * attempt + Math.random() * 50));
          continue;
        }
        throw err;
      }
    }
    throw new Error("Transaction failed after maximum retries");
  }

  /**
   * Registers a newly uploaded resource as a DRAFT after strictly verifying physical storage metadata.
   * Fails closed if storage metadata is missing or does not match declared payload.
   */
  static async createDraft(userId: string, data: CreateStudentResourceInput) {
    if (!data.path.startsWith(STUDENT_RESOURCES_PREFIX(userId))) {
      throw new Error("Upload path does not belong to this user");
    }

    const objectInfo = await this.resolveObjectAndVerifyMetadata(data.path);
    if (!objectInfo || !objectInfo.storageObjectId) {
      throw new Error("Upload not found — make sure the file finished uploading before registering it");
    }

    // Fail-closed verification: storage metadata must exist
    const meta = objectInfo.metadata;
    if (!meta) {
      throw new Error("Physical file metadata is missing in storage. Ensure file upload completed successfully.");
    }

    const physicalSize = meta.size;
    const physicalMimeType = meta.mimetype || meta.contentType;

    // 1. actual stored size exists and is 1..50 MB
    if (typeof physicalSize !== "number" || isNaN(physicalSize) || physicalSize < 1 || physicalSize > MAX_UPLOAD_SIZE_BYTES) {
      throw new Error(
        `Invalid stored file size (${physicalSize ?? "missing"}). File size must be between 1 byte and ${MAX_UPLOAD_SIZE_BYTES / (1024 * 1024)}MB.`
      );
    }

    // 2. actual stored MIME exists and is allowed
    if (!physicalMimeType || !ALLOWED_UPLOAD_MIME_TYPES.includes(physicalMimeType as any)) {
      throw new Error(
        `Invalid stored file MIME type (${physicalMimeType ?? "missing"}). Allowed formats: ${ALLOWED_UPLOAD_MIME_TYPES.join(", ")}.`
      );
    }

    // 3. actual stored size equals declared sizeBytes
    if (physicalSize !== data.sizeBytes) {
      throw new Error(
        `Physical file size mismatch: stored file is ${physicalSize} bytes, but declared sizeBytes is ${data.sizeBytes} bytes.`
      );
    }

    // 4. actual stored MIME equals declared contentType
    if (physicalMimeType !== data.contentType) {
      throw new Error(
        `Physical file MIME type mismatch: stored file is "${physicalMimeType}", but declared contentType is "${data.contentType}".`
      );
    }

    const fileFormat = this.deriveFileFormat(data.path);

    try {
      return await prisma.studentResource.create({
        data: {
          userId,
          storageObjectId: objectInfo.storageObjectId,
          storagePath: data.path,
          mimeType: physicalMimeType,
          sizeBytes: physicalSize,
          title: data.title,
          description: data.description ?? null,
          level: data.level,
          department: data.department,
          courseCode: data.courseCode?.trim() || "",
          courseTitle: data.courseTitle,
          resourceType: data.resourceType,
          fileFormat,
          status: StudentResourceStatus.DRAFT,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new Error("This upload has already been registered");
      }
      throw err;
    }
  }

  /**
   * Strips storagePath AND storageObjectId before any StudentResource is
   * sent to the frontend. storagePath is an internal reference into
   * Supabase Storage; storageObjectId is the raw storage.objects row id
   * — both are internal plumbing, never something a client needs or
   * should see. Clients must always be issued a short-lived signed URL
   * instead (matching the existing Book download/preview pattern in
   * StorageService), never either raw identifier. Every controller
   * response that includes a StudentResource (or an array of them) must
   * pass through this first.
   */
  static toPublicResource<T extends { storagePath: string; storageObjectId: string }>(
    resource: T
  ): Omit<T, "storagePath" | "storageObjectId"> {
    const { storagePath, storageObjectId, ...rest } = resource;
    return rest;
  }

  /**
   * Submits a DRAFT student resource for admin review, transitioning status to PENDING_REVIEW.
   * Executes inside a serializable transaction with Lagos day rate limiting.
   */
  static async submitResource(userId: string, resourceId: string) {
    return await this.runSerializableTransaction(async (tx) => {
      const resource = await tx.studentResource.findFirst({
        where: { id: resourceId, userId },
      });

      if (!resource) {
        throw new Error("Resource not found or unauthorized");
      }

      // ONLY DRAFT resources can be submitted for review
      if (resource.status !== StudentResourceStatus.DRAFT) {
        throw new Error(`Only DRAFT resources can be submitted for review. Current status: ${resource.status}`);
      }

      // Lagos day boundary evaluation
      const { start: lagosStart, end: lagosEnd } = getLagosDayBounds(new Date());

      // 6-submission check inside serializable transaction
      const todaySubmissionsCount = await tx.studentResource.count({
        where: {
          userId,
          submittedAt: {
            gte: lagosStart,
            lte: lagosEnd,
          },
          status: { not: StudentResourceStatus.DRAFT },
        },
      });

      if (todaySubmissionsCount >= 6) {
        throw new Error("Daily submission limit reached (maximum 6 submissions per day)");
      }

      return await tx.studentResource.update({
        where: { id: resourceId },
        data: {
          status: StudentResourceStatus.PENDING_REVIEW,
          submittedAt: new Date(),
        },
      });
    });
  }

  // -------------------------------------------------------------------------
  // Admin moderation (Gate 7)
  // -------------------------------------------------------------------------

  /**
   * Admin review queue: lists student resources, optionally filtered by
   * status, paginated, oldest-submitted first (matches the
   * [status, submittedAt] index built for this exact query). Every row
   * also carries a derived SLA flag (isOverdue/hoursWaiting) so the admin
   * UI can surface stale PENDING_REVIEW items without a separate query —
   * see computeReviewSla just below.
   */
  static async listResources(status: StudentResourceStatus | undefined, page: number, limit: number) {
    const where = status ? { status } : {};

    const [resources, total] = await Promise.all([
      prisma.studentResource.findMany({
        where,
        orderBy: { submittedAt: "asc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: { select: { id: true, name: true, email: true, username: true } },
        },
      }),
      prisma.studentResource.count({ where }),
    ]);

    return {
      resources: resources.map((r) => ({ ...r, ...this.computeReviewSla(r) })),
      pagination: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  }

  // How long a resource may sit in PENDING_REVIEW before the admin list
  // flags it as overdue. Deliberately a plain wall-clock window (not a
  // Lagos-calendar-day boundary like DailyGoal/streak logic) — moderation
  // SLA is about elapsed waiting time, not which calendar day it happened
  // to land on.
  private static readonly PENDING_REVIEW_SLA_HOURS = 6;

  /**
   * Purely a read-time projection, never persisted: isOverdue/hoursWaiting
   * are fully derivable from submittedAt + status on every read, so
   * storing them would just be a second copy that can drift from the SLA
   * constant above if it's ever tuned. Only meaningful while the resource
   * is still awaiting a decision — once reviewed, it's resolved and no
   * longer "waiting" on anything, so both fields go inert (false/null)
   * for every other status rather than reporting a stale, ever-growing
   * wait time for something an admin already acted on.
   */
  private static computeReviewSla(resource: { status: StudentResourceStatus; submittedAt: Date }): {
    isOverdue: boolean;
    hoursWaiting: number | null;
  } {
    if (resource.status !== StudentResourceStatus.PENDING_REVIEW) {
      return { isOverdue: false, hoursWaiting: null };
    }

    const hoursWaiting = (Date.now() - resource.submittedAt.getTime()) / (60 * 60 * 1000);
    return {
      isOverdue: hoursWaiting > this.PENDING_REVIEW_SLA_HOURS,
      hoursWaiting: Math.round(hoursWaiting * 10) / 10,
    };
  }

  /**
   * Approves or rejects a PENDING_REVIEW resource. Approval runs the full
   * accounting chain (status, DailyGoal upsert, single ResourceContribution,
   * UserProgression recalculation) in one serializable transaction. The
   * PENDING_REVIEW-only guard, combined with ResourceContribution.studentResourceId
   * being @unique, is what makes a duplicate approval impossible — a second
   * attempt either fails the status check (already APPROVED) or, under
   * concurrent requests, loses the serializable conflict and retries into
   * that same status check.
   */
  static async reviewResource(
    adminId: string,
    resourceId: string,
    action: "APPROVE" | "REJECT",
    reason?: string
  ) {
    return await this.runSerializableTransaction(async (tx) => {
      const resource = await tx.studentResource.findUnique({ where: { id: resourceId } });
      if (!resource) {
        throw new Error("Resource not found");
      }
      if (resource.status !== StudentResourceStatus.PENDING_REVIEW) {
        throw new Error(`Only PENDING_REVIEW resources can be reviewed. Current status: ${resource.status}`);
      }

      const now = new Date();

      if (action === "REJECT") {
        return await tx.studentResource.update({
          where: { id: resourceId },
          data: {
            status: StudentResourceStatus.REJECTED,
            reviewedByAdminId: adminId,
            reviewedAt: now,
            rejectionReason: reason,
          },
        });
      }

      // APPROVE
      const approved = await tx.studentResource.update({
        where: { id: resourceId },
        data: {
          status: StudentResourceStatus.APPROVED,
          reviewedByAdminId: adminId,
          reviewedAt: now,
          approvedAt: now,
        },
      });

      const activityDate = getLagosCalendarDate(now);

      const dailyGoal = await tx.dailyGoal.upsert({
        where: { userId_activityDate: { userId: resource.userId, activityDate } },
        update: { updatedAt: now },
        create: { userId: resource.userId, activityDate },
      });

      try {
        await tx.resourceContribution.create({
          data: {
            studentResourceId: resource.id,
            dailyGoalId: dailyGoal.id,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          throw new Error("This resource has already been approved and counted");
        }
        throw err;
      }

      await ProgressionService.recalculateUserProgression(tx, resource.userId);

      return approved;
    });
  }

  /**
   * Archives a DRAFT, PENDING_REVIEW, REJECTED, or APPROVED resource.
   * Only an APPROVED resource has an active ResourceContribution to revoke
   * — never deleting it, matching the existing audit-trail guarantee — and
   * only then does progression need recalculating. Archiving from any of
   * the other three statuses is a pure status flip: there is nothing to
   * revoke or recalculate because those statuses never earned a
   * contribution in the first place.
   */
  static async archiveResource(resourceId: string, reason?: string) {
    const ARCHIVABLE_STATUSES: StudentResourceStatus[] = [
      StudentResourceStatus.DRAFT,
      StudentResourceStatus.PENDING_REVIEW,
      StudentResourceStatus.REJECTED,
      StudentResourceStatus.APPROVED,
    ];

    return await this.runSerializableTransaction(async (tx) => {
      const resource = await tx.studentResource.findUnique({
        where: { id: resourceId },
        include: { contribution: true },
      });

      if (!resource) {
        throw new Error("Resource not found");
      }
      if (!ARCHIVABLE_STATUSES.includes(resource.status)) {
        throw new Error(
          `Only DRAFT, PENDING_REVIEW, REJECTED, or APPROVED resources can be archived. Current status: ${resource.status}`
        );
      }

      const wasApproved = resource.status === StudentResourceStatus.APPROVED;

      if (wasApproved) {
        if (!resource.contribution || resource.contribution.revokedAt) {
          throw new Error("Approved resource has no active contribution to revoke");
        }

        await tx.resourceContribution.update({
          where: { id: resource.contribution.id },
          data: {
            revokedAt: new Date(),
            revocationReason: reason ?? "Archived by admin",
          },
        });
      }

      const archived = await tx.studentResource.update({
        where: { id: resourceId },
        data: { status: StudentResourceStatus.ARCHIVED },
      });

      if (wasApproved) {
        await ProgressionService.recalculateUserProgression(tx, resource.userId);
      }

      return archived;
    });
  }

  /**
   * Generates a signed preview URL for an admin to securely stream/inspect
   * any student resource document without making the bucket public.
   * TTL is 3600 seconds (1 hour).
   */
  static async getAdminResourcePreviewUrl(
    resourceId: string,
    expiresIn: number = 3600
  ): Promise<{ signedUrl: string; expiresIn: number }> {
    const resource = await prisma.studentResource.findUnique({
      where: { id: resourceId },
    });
    if (!resource) {
      throw new Error("Resource not found");
    }

    let bucket = BUCKET;
    let path = resource.storagePath;

    const location = await this.resolveObjectLocation(resource.storageObjectId);
    if (location) {
      bucket = location.bucket_id;
      path = location.name;
    } else if (!path) {
      throw new Error("Physical file payload not found in storage bucket");
    }

    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUrl(path, expiresIn, { download: false });

    if (error || !data?.signedUrl) {
      throw new Error(error?.message || "Failed to generate preview URL");
    }

    return {
      signedUrl: data.signedUrl,
      expiresIn,
    };
  }

  // ---------------------------------------------------------------------------
  // Gate 12 — Vault publication (student-facing discovery + signed access)
  // ---------------------------------------------------------------------------

  /**
   * Resolves the physical storage.objects location for a storageObjectId.
   * Mirrors StorageService.resolveObjectLocation exactly — kept as a
   * separate private copy here rather than shared, matching the existing
   * precedent that StorageService and StudentResourceService already don't
   * share private storage helpers (each independently verifies its own
   * bucket/table).
   */
  private static async resolveObjectLocation(
    storageObjectId: string
  ): Promise<{ name: string; bucket_id: string } | null> {
    const rows = await prisma.$queryRaw<Array<{ name: string; bucket_id: string }>>`
      SELECT name, bucket_id FROM storage.objects WHERE id = ${storageObjectId}::uuid LIMIT 1
    `;
    return rows[0] ?? null;
  }

  /**
   * GET /api/vault — published (APPROVED) student resources matching the
   * caller's own onboarding level/department. `level`/`department` are
   * never accepted from the caller; onboarding is looked up fresh on every
   * call from the authenticated userId. A student with no Onboarding row
   * yet gets an empty page, not an error — matching
   * StorageService.getPersonalizedFeed's existing graceful-empty behavior.
   *
   * Exact equality on level/department (no wildcard, no case-insensitivity)
   * — see docs/gate12-vault-publication-design.md §4 for why this
   * deliberately differs from the admin-curated Book feed's matching rules.
   */
  static async listVaultResources(userId: string, query: VaultQueryInput) {
    const onboarding = await prisma.onboarding.findUnique({ where: { userId } });
    if (!onboarding) {
      return { resources: [], pagination: { page: query.page, limit: query.limit, total: 0, totalPages: 0 } };
    }

    const where: Prisma.StudentResourceWhereInput = {
      status: StudentResourceStatus.APPROVED,
      level: onboarding.level,
      department: onboarding.department,
    };

    if (query.courseCode) {
      where.courseCode = query.courseCode;
    }
    if (query.resourceType) {
      where.resourceType = query.resourceType;
    }
    if (query.search) {
      // Escape ILIKE wildcard metacharacters, matching
      // ProgressionService.listUserProgression's existing search escaping —
      // mandatory for any ILIKE built from user input in this codebase.
      const escaped = query.search.replace(/[\\%_]/g, (m) => `\\${m}`);
      const pattern = `%${escaped}%`;
      where.OR = [
        { title: { contains: pattern, mode: "insensitive" } },
        { courseTitle: { contains: pattern, mode: "insensitive" } },
        { courseCode: { contains: pattern, mode: "insensitive" } },
        { description: { contains: pattern, mode: "insensitive" } },
      ];
    }

    const [resources, total] = await Promise.all([
      prisma.studentResource.findMany({
        where,
        orderBy: { approvedAt: "desc" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.studentResource.count({ where }),
    ]);

    return {
      resources,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
      },
    };
  }

  /**
   * GET /api/vault/:id/url — signed preview/download URL for a published
   * resource, gated on the same three checks every time: APPROVED status,
   * level match, department match — all re-derived fresh from the DB, never
   * trusted from a prior call. Any failure throws "Resource not found",
   * which the controller maps to 404 (never 403) so an ineligible student
   * can't distinguish "doesn't exist" from "exists but isn't eligible" —
   * matching the existing GET /api/notifications/:id convention.
   *
   * mode="preview" → inline Content-Disposition (renders in-browser).
   * mode="download" → attachment Content-Disposition (forces a save dialog).
   * Never returns storagePath, storageObjectId, or any raw bucket path —
   * only the short-lived signedUrl itself.
   */
  static async getVaultResourceSignedUrl(
    userId: string,
    resourceId: string,
    mode: "preview" | "download"
  ): Promise<string> {
    const onboarding = await prisma.onboarding.findUnique({ where: { userId } });
    if (!onboarding) {
      throw new Error("Resource not found");
    }

    const resource = await prisma.studentResource.findFirst({
      where: {
        id: resourceId,
        status: StudentResourceStatus.APPROVED,
        level: onboarding.level,
        department: onboarding.department,
      },
    });
    if (!resource) {
      throw new Error("Resource not found");
    }

    const location = await this.resolveObjectLocation(resource.storageObjectId);
    if (!location) {
      throw new Error("Physical file payload not found in storage bucket");
    }

    const ttl = mode === "preview" ? VAULT_PREVIEW_URL_TTL_SECONDS : VAULT_DOWNLOAD_URL_TTL_SECONDS;

    // Explicit, not implicit: `download: false` and `download: true` are
    // functionally the only two states Supabase Storage's signed-URL API
    // exposes for Content-Disposition (there is no separate "inline" flag
    // — omitting `download` entirely happens to produce inline, but relying
    // on that omission is easy to accidentally break, e.g. by refactoring
    // the ternary below into an `options?: {...}` spread). Preview must
    // render in-browser (inline); download must force a save dialog
    // (attachment) — both are spelled out here so the choice is visible at
    // the call site, not inferred from an absent key.
    const { data, error } = await supabaseAdmin.storage
      .from(location.bucket_id)
      .createSignedUrl(location.name, ttl, mode === "download" ? { download: true } : { download: false });

    if (error || !data?.signedUrl) {
      throw new Error(error?.message || "Failed to generate signed URL");
    }

    return data.signedUrl;
  }

  /**
   * GET /api/student-resources/mine — the caller's own resources in every
   * status (DRAFT/PENDING_REVIEW/APPROVED/REJECTED/ARCHIVED), including
   * rejectionReason. Ownership-based (userId from token only, never a
   * param), NOT eligibility-filtered — unlike listVaultResources, a
   * student must be able to see their own rejected/draft/archived work,
   * which by definition never appears in /api/vault.
   */
  static async listMyResources(userId: string, status?: StudentResourceStatus) {
    return prisma.studentResource.findMany({
      where: { userId, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
    });
  }
}

export { StudentResourceStatus, StudentResourceType, FileFormat };
