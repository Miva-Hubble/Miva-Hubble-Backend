// services/studentResourceService.ts

import { randomUUID } from "crypto";
import prisma from "../lib/prisma.js";
import { supabaseAdmin } from "../config/supabase.js";
import { StudentResourceStatus, StudentResourceType, FileFormat, BookStatus, Prisma } from "@prisma/client";
import type { CreateStudentResourceInput, VaultQueryInput } from "../schemas/studentResource.schema.js";
import { ALLOWED_UPLOAD_MIME_TYPES, MAX_UPLOAD_SIZE_BYTES } from "../schemas/storage.schema.js";
import { getLagosDayBounds, getLagosCalendarDate } from "../lib/lagosTime.js";
import { ProgressionService } from "./progressionService.js";
import { StorageService } from "./storageService.js";
import { TARGETING_WILDCARD } from "../constants/taxonomy.js";

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

// ---------------------------------------------------------------------------
// Gate 13 — unified Vault feed (admin Books + student-approved resources)
//
// Book and StudentResource stay two separate tables with two separate
// write-side lifecycles (admin CRUD vs submit->review->approve) — merging
// the schemas would mean bolting moderation-only columns onto Book and
// admin-only columns onto StudentResource for no reason. What's unified is
// only the READ side: one feed, one DTO, one `source` discriminator so the
// frontend never has to know two tables are behind it.
// ---------------------------------------------------------------------------
export type FeedResourceSource = "BOOK" | "STUDENT";

export interface FeedResource {
  id: string;
  source: FeedResourceSource;
  title: string;
  description: string | null;
  level: string;
  department: string;
  resourceType: string;
  fileFormat: string;
  courseCode: string | null;
  courseTitle: string | null;
  uploaderName: string | null;
  coverImageUrl: string | null;
  downloadCount: number | null;
  createdAt: Date;
}

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
   * GET /api/vault — the unified "All Resources" feed: admin-curated
   * PUBLISHED Books plus student APPROVED StudentResources, matching the
   * caller's own onboarding level/department. `level`/`department` are
   * never accepted from the caller; onboarding is looked up fresh on every
   * call from the authenticated userId. A student with no Onboarding row
   * yet gets an empty page, not an error.
   *
   * Each source is filtered to its OWN eligibility rule INSIDE its own
   * query branch, before the two branches are ever combined — this is
   * deliberate and non-negotiable. Book keeps its existing wildcard rule
   * (`level = 'All'` / `department = 'All'` match anyone) and
   * case-insensitive department match; StudentResource keeps its existing
   * exact-equality rule and only ever includes status = APPROVED rows —
   * never PENDING_REVIEW, REJECTED, DRAFT, or ARCHIVED. Filtering inside
   * each branch (not as a post-union WHERE) is what makes it structurally
   * impossible for a query-shape change to leak another student's pending
   * submission or a mismatched-level Book into this feed.
   *
   * Implemented as one $queryRaw UNION ALL (CTE per source + a window-
   * function total count), the same pattern ProgressionService.
   * listUserProgression already uses, rather than two Prisma calls merged
   * in Node — that keeps LIMIT/OFFSET correct across both sources instead
   * of the classic "page 2 is wrong" bug you get from independently
   * paginating two result sets and stitching them together afterward.
   */
  static async listVaultResources(userId: string, query: VaultQueryInput) {
    const onboarding = await prisma.onboarding.findUnique({ where: { userId } });
    if (!onboarding) {
      return { resources: [] as FeedResource[], pagination: { page: query.page, limit: query.limit, total: 0, totalPages: 0 } };
    }

    const { level, department } = onboarding;
    const offset = (query.page - 1) * query.limit;

    const bookConditions: Prisma.Sql[] = [
      Prisma.sql`b.status = 'PUBLISHED'`,
      Prisma.sql`(b.level = ${level} OR b.level = 'All')`,
      Prisma.sql`(b.department ILIKE ${department} OR b.department = 'All')`,
    ];
    const studentConditions: Prisma.Sql[] = [
      Prisma.sql`sr.status = 'APPROVED'`,
      Prisma.sql`sr.level = ${level}`,
      Prisma.sql`sr.department = ${department}`,
    ];

    if (query.courseCode) {
      // Books carry no course association at all — this filter naturally
      // excludes every Book row rather than needing a special case.
      bookConditions.push(Prisma.sql`FALSE`);
      studentConditions.push(Prisma.sql`sr.course_code = ${query.courseCode}`);
    }
    if (query.resourceType) {
      // BookType and StudentResourceType are different Postgres enums but
      // share three member names (PAST_QUESTION/STUDY_GUIDE/REFERENCE) —
      // comparing both as text against the same filter value naturally
      // yields the right result for the shared names and naturally excludes
      // every row of the source whose enum doesn't have that member (e.g.
      // "NOTE" only ever matches StudentResource; "TEXTBOOK" only Book).
      bookConditions.push(Prisma.sql`b.book_type::text = ${query.resourceType}`);
      studentConditions.push(Prisma.sql`sr.resource_type::text = ${query.resourceType}`);
    }
    if (query.search) {
      // Escape ILIKE wildcard metacharacters, matching
      // ProgressionService.listUserProgression's existing search escaping —
      // mandatory for any ILIKE built from user input in this codebase.
      const escaped = query.search.replace(/[\\%_]/g, (m) => `\\${m}`);
      const pattern = `%${escaped}%`;
      bookConditions.push(
        Prisma.sql`(b.title ILIKE ${pattern} ESCAPE '\\' OR b.description ILIKE ${pattern} ESCAPE '\\' OR b.author ILIKE ${pattern} ESCAPE '\\')`
      );
      studentConditions.push(
        Prisma.sql`(sr.title ILIKE ${pattern} ESCAPE '\\' OR sr.description ILIKE ${pattern} ESCAPE '\\' OR sr.course_code ILIKE ${pattern} ESCAPE '\\' OR sr.course_title ILIKE ${pattern} ESCAPE '\\')`
      );
    }

    type FeedRow = {
      id: string;
      source: FeedResourceSource;
      title: string;
      description: string | null;
      level: string;
      department: string;
      resource_type: string;
      file_format: string;
      course_code: string | null;
      course_title: string | null;
      uploader_name: string | null;
      cover_image_url: string | null;
      download_count: number | null;
      created_at: Date;
      total_count: number;
    };

    const rows = await prisma.$queryRaw<FeedRow[]>(Prisma.sql`
      WITH eligible_books AS (
        SELECT
          b.id::text AS id,
          'BOOK' AS source,
          b.title,
          b.description,
          b.level,
          b.department,
          b.book_type::text AS resource_type,
          b.file_format::text AS file_format,
          NULL::text AS course_code,
          NULL::text AS course_title,
          b.author AS uploader_name,
          b.cover_image_url AS cover_image_url,
          b.download_count AS download_count,
          b.created_at AS created_at
        FROM books b
        WHERE ${Prisma.join(bookConditions, " AND ")}
      ),
      eligible_student_resources AS (
        SELECT
          sr.id::text AS id,
          'STUDENT' AS source,
          sr.title,
          sr.description,
          sr.level,
          sr.department,
          sr.resource_type::text AS resource_type,
          sr.file_format::text AS file_format,
          sr.course_code AS course_code,
          sr.course_title AS course_title,
          u.name AS uploader_name,
          NULL::text AS cover_image_url,
          NULL::int AS download_count,
          sr.approved_at AS created_at
        FROM student_resources sr
        JOIN "User" u ON u.id = sr.user_id
        WHERE ${Prisma.join(studentConditions, " AND ")}
      ),
      combined AS (
        SELECT * FROM eligible_books
        UNION ALL
        SELECT * FROM eligible_student_resources
      )
      SELECT *, COUNT(*) OVER()::int AS total_count
      FROM combined
      ORDER BY created_at DESC
      LIMIT ${query.limit} OFFSET ${offset}
    `);

    const total = rows[0]?.total_count ?? 0;

    const resources: FeedResource[] = rows.map((r) => ({
      id: r.id,
      source: r.source,
      title: r.title,
      description: r.description,
      level: r.level,
      department: r.department,
      resourceType: r.resource_type,
      fileFormat: r.file_format,
      courseCode: r.course_code,
      courseTitle: r.course_title,
      uploaderName: r.uploader_name,
      coverImageUrl: r.cover_image_url,
      downloadCount: r.download_count,
      createdAt: r.created_at,
    }));

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
   * feed item, gated on the same eligibility checks listVaultResources uses
   * — all re-derived fresh from the DB, never trusted from a prior /api/vault
   * call. Any failure throws "Resource not found", which the controller
   * maps to 404 (never 403) so an ineligible student can't distinguish
   * "doesn't exist" from "exists but isn't eligible" — matching the existing
   * GET /api/notifications/:id convention.
   *
   * Tries the StudentResource source first, then Book — a plain fallback,
   * not a "which source is this id" lookup, since the two tables draw their
   * ids from independent uuid() pools and a collision between them is
   * cryptographically negligible.
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

    const studentResource = await prisma.studentResource.findFirst({
      where: {
        id: resourceId,
        status: StudentResourceStatus.APPROVED,
        level: onboarding.level,
        department: onboarding.department,
      },
    });

    let storageObjectId: string;
    let approvedBookId: string | null = null;

    if (studentResource) {
      storageObjectId = studentResource.storageObjectId;
    } else {
      const book = await prisma.book.findFirst({
        where: {
          id: resourceId,
          status: BookStatus.PUBLISHED,
          AND: [
            { OR: [{ level: onboarding.level }, { level: TARGETING_WILDCARD }] },
            {
              OR: [
                { department: { equals: onboarding.department, mode: "insensitive" } },
                { department: TARGETING_WILDCARD },
              ],
            },
          ],
        },
      });
      if (!book) {
        throw new Error("Resource not found");
      }
      storageObjectId = book.storageObjectId;
      approvedBookId = book.id;
    }

    const location = await this.resolveObjectLocation(storageObjectId);
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

    // Book engagement counters (downloadCount/previewCount) only make sense
    // for the BOOK source — StudentResource has no equivalent counter today.
    // Fire-and-forget, same rationale as StorageService.generatePresignedUrl:
    // this is a hot read path and must never block the response on a
    // secondary DB write.
    if (approvedBookId) {
      StorageService.recordBookEngagement(userId, approvedBookId, mode === "download" ? "DOWNLOAD" : "PREVIEW").catch(
        (err) => {
          console.error(`[vault] Failed to record book engagement:`, err);
        }
      );
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
