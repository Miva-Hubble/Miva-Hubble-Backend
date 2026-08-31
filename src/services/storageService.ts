// services/storageService.ts

import { randomUUID } from "crypto";
import prisma from "../lib/prisma.js";
import { supabaseAdmin } from "../config/supabase.js";
import { BookType, BookStatus, FileFormat, Prisma } from "@prisma/client";
import type { CreateBookInput, UpdateBookInput } from "../schemas/storage.schema.js";
import { TARGETING_WILDCARD } from "../constants/taxonomy.js";

// Extension -> FileFormat. Deliberately separate from
// MIME_TYPE_TO_FILE_FORMAT in storage.schema.ts: that map validates the
// *upload request's declared* contentType, while this one derives the
// format from the *path we actually generated and stored* — the same trust
// boundary already used for storageObjectId (see resolveObjectIdByPath).
const EXTENSION_TO_FILE_FORMAT: Record<string, FileFormat> = {
  pdf: FileFormat.PDF,
  epub: FileFormat.EPUB,
  doc: FileFormat.DOC,
  docx: FileFormat.DOCX,
};

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "resources";
const BOOK_COVERS_BUCKET = process.env.SUPABASE_BOOK_COVERS_BUCKET || "book-covers";

const USER_FILES_PREFIX = (userId: string) => `users/${userId}/`;
const BOOKS_PREFIX = "books/global/";
const BOOK_COVERS_PREFIX = "covers/";

const ALLOWED_COVER_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "avif"]);


// Signed *download* URLs default to a few minutes — long enough for a slow
// connection to actually start pulling a large PDF/EPUB, short enough that a
// leaked link goes stale quickly.
const DEFAULT_DOWNLOAD_URL_TTL_SECONDS = 120;

export class StorageService {
  // -------------------------------------------------------------------
  // Upload URLs
  // -------------------------------------------------------------------

  /**
   * Issues a Supabase signed upload URL. The path is always constructed
   * here, server-side — the caller only supplies a filename. This is what
   * makes the later "register" step safe to trust: a student can only ever
   * register a path under their own `users/{userId}/` prefix because that's
   * the only prefix we ever handed them a signed URL for, and an admin can
   * only register under `books/global/`.
   */
  private static async createSignedUploadUrl(pathPrefix: string, filename: string) {
    const sanitizedFilename = filename.replace(/[\\/]/g, "_");
    const path = `${pathPrefix}${randomUUID()}_${sanitizedFilename}`;

    const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUploadUrl(path);

    if (error || !data) {
      throw new Error(error?.message || "Failed to create upload URL");
    }

    return { signedUrl: data.signedUrl, token: data.token, path };
  }

  static createUserUploadUrl(userId: string, filename: string) {
    return this.createSignedUploadUrl(USER_FILES_PREFIX(userId), filename);
  }

  static createBookUploadUrl(filename: string) {
    return this.createSignedUploadUrl(BOOKS_PREFIX, filename);
  }

  /**
   * Issues a signed upload URL for a book cover image into the public
   * `book-covers` bucket. Validates the file extension server-side so only
   * image types (jpg/jpeg/png/webp/avif) are accepted. The resulting public
   * URL is stored as `coverImageUrl` on the Book row — it's served directly
   * by Supabase CDN without a signed token because covers are public assets.
   */
  static async createBookCoverUploadUrl(filename: string) {
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_COVER_EXTENSIONS.has(ext)) {
      throw new Error(`Cover image must be one of: jpg, jpeg, png, webp, avif. Got: .${ext}`);
    }
    const sanitizedFilename = filename.replace(/[\\/]/g, "_");
    const path = `${BOOK_COVERS_PREFIX}${randomUUID()}_${sanitizedFilename}`;

    const { data, error } = await supabaseAdmin.storage
      .from(BOOK_COVERS_BUCKET)
      .createSignedUploadUrl(path);

    if (error || !data) {
      throw new Error(error?.message || "Failed to create cover image upload URL");
    }

    // Construct the permanent public URL — no expiry since the bucket is public.
    const publicUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/${BOOK_COVERS_BUCKET}/${path}`;

    return { signedUrl: data.signedUrl, token: data.token, path, publicUrl };
  }


  /**
   * Looks up the storage.objects row Supabase created for a given path once
   * the client's direct-to-storage upload has completed. We resolve the id
   * ourselves from the path we generated rather than ever trusting an id
   * supplied by the client — a client-supplied storageObjectId would let
   * anyone attach an arbitrary (possibly someone else's) storage object to
   * their own UserFile/Book row.
   */
  private static async resolveObjectIdByPath(path: string): Promise<string | null> {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM storage.objects WHERE bucket_id = ${BUCKET} AND name = ${path} LIMIT 1
    `;
    return rows[0]?.id ?? null;
  }

  private static async resolveObjectLocation(storageObjectId: string): Promise<{ name: string; bucket_id: string } | null> {
    const rows = await prisma.$queryRaw<Array<{ name: string; bucket_id: string }>>`
      SELECT name, bucket_id FROM storage.objects WHERE id = ${storageObjectId}::uuid LIMIT 1
    `;
    return rows[0] ?? null;
  }

  /**
   * Derives the FileFormat enum from the extension on a server-generated
   * storage path (e.g. "books/global/{uuid}_textbook.pdf" -> PDF). We never
   * trust a client-supplied format for the same reason we never trust a
   * client-supplied storageObjectId: the path is only ever one this service
   * itself constructed in createSignedUploadUrl, so its extension is a
   * reliable fact about the file, not client input.
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

  // -------------------------------------------------------------------
  // Student private files
  // -------------------------------------------------------------------

  static async createUserFile(userId: string, path: string, customLabel?: string) {
    if (!path.startsWith(USER_FILES_PREFIX(userId))) {
      throw new Error("Upload path does not belong to this user");
    }

    const storageObjectId = await this.resolveObjectIdByPath(path);
    if (!storageObjectId) {
      throw new Error("Upload not found — make sure the file finished uploading before registering it");
    }

    try {
      return await prisma.userFile.create({
        data: { userId, storageObjectId, customLabel },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new Error("This upload has already been registered");
      }
      throw err;
    }
  }

  static listUserFiles(userId: string) {
    return prisma.userFile.findMany({
      where: { userId, isArchived: false },
      orderBy: { createdAt: "desc" },
    });
  }

  static async archiveUserFile(userId: string, fileId: string) {
    const { count } = await prisma.userFile.updateMany({
      where: { id: fileId, userId },
      data: { isArchived: true },
    });
    if (count === 0) throw new Error("File not found or unauthorized");
  }

  // -------------------------------------------------------------------
  // Admin book management
  // -------------------------------------------------------------------

  static async createBook(data: CreateBookInput) {
    if (!data.path.startsWith(BOOKS_PREFIX)) {
      throw new Error("Upload path is not a valid library book path");
    }

    const storageObjectId = await this.resolveObjectIdByPath(data.path);
    if (!storageObjectId) {
      throw new Error("Upload not found — make sure the file finished uploading before registering it");
    }

    const fileFormat = this.deriveFileFormat(data.path);

    try {
      return await prisma.book.create({
        data: {
          storageObjectId,
          title: data.title,
          author: data.author,
          description: data.description,
          level: data.level,
          department: data.department,
          bookType: data.bookType,
          fileFormat,
          coverImageUrl: data.coverImageUrl ?? null,
          tags: data.tags,
          status: data.status || BookStatus.DRAFT,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new Error("This upload has already been registered as a book");
      }
      throw err;
    }
  }

  static async updateBook(bookId: string, data: UpdateBookInput) {
    try {
      return await prisma.book.update({ where: { id: bookId }, data });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
        throw new Error("Book not found");
      }
      throw err;
    }
  }

  static listAllBooksForAdmin(status?: BookStatus) {
    return prisma.book.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Deletes the physical object from Supabase Storage, then removes the
   * metadata row. We don't rely solely on the storage.objects -> books
   * cascade for the DB row: that cascade only takes effect once the manual
   * cross-schema migration has actually been applied to this environment,
   * so we clean up the Prisma row explicitly too and treat "already gone"
   * (P2025, e.g. the cascade beat us to it) as success.
   */
  static async deleteBook(bookId: string) {
    const book = await prisma.book.findUnique({ where: { id: bookId } });
    if (!book) throw new Error("Book not found");

    const location = await this.resolveObjectLocation(book.storageObjectId);
    if (location) {
      const { error } = await supabaseAdmin.storage.from(location.bucket_id).remove([location.name]);
      if (error) throw new Error(`Failed to delete file from storage: ${error.message}`);
    }

    try {
      await prisma.book.delete({ where: { id: bookId } });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025")) {
        throw err;
      }
    }
  }

  // -------------------------------------------------------------------
  // Personalized distribution
  // -------------------------------------------------------------------

  static async getPersonalizedFeed(userId: string) {
    const onboarding = await prisma.onboarding.findUnique({ where: { userId } });
    if (!onboarding) return [];

    return prisma.book.findMany({
      where: {
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
      orderBy: { createdAt: "desc" },
    });
  }

  // -------------------------------------------------------------------
  // Signed download URLs
  // -------------------------------------------------------------------

  static async generatePresignedUrl(
    userId: string,
    assetId: string,
    isBook: boolean,
    mode: "preview" | "download" = "download",
    expiresIn?: number,
  ): Promise<{ signedUrl: string; previewCount?: number; downloadCount?: number }> {
    // Preview needs a longer TTL — the signed URL must survive the full
    // PDF load, not just the initial connection handshake. Download URLs
    // can stay short because the browser starts pulling immediately.
    const ttl = expiresIn ?? (mode === "preview" ? 300 : DEFAULT_DOWNLOAD_URL_TTL_SECONDS);
    let storageObjectId: string;
    // Captured only on the isBook branch so we can project an updated
    // count below without a second round-trip to fetch the book again.
    let bookForCount: { previewCount: number; downloadCount: number } | null = null;

    if (isBook) {
      const book = await prisma.book.findFirst({
        where: { id: assetId, status: BookStatus.PUBLISHED },
      });
      if (!book) throw new Error("Book not found or unavailable");
      storageObjectId = book.storageObjectId;
      bookForCount = book;
    } else {
      const file = await prisma.userFile.findFirst({
        where: { id: assetId, userId, isArchived: false },
      });
      if (!file) throw new Error("File not found or unauthorized");
      storageObjectId = file.storageObjectId;
    }

    const location = await this.resolveObjectLocation(storageObjectId);
    if (!location) throw new Error("Physical file payload not found in storage bucket");

    const { data, error } = await supabaseAdmin.storage
      .from(location.bucket_id)
      .createSignedUrl(location.name, ttl, mode === "download" ? { download: true } : undefined);

    if (error || !data?.signedUrl) {
      throw new Error(error?.message || "Failed to generate download URL");
    }

    // If interacting with a published book, record engagement.
    // Tries BullMQ background queue first; falls back to direct DB record if Redis is unavailable.
    if (isBook) {
      this.recordEngagement(userId, assetId, mode === "download" ? "DOWNLOAD" : "PREVIEW").catch((err) => {
        console.error(`[storage] Failed to record book engagement:`, err);
      });
    }

    return data.signedUrl;
  }

  /**
   * Records unique engagement with guaranteed execution directly into PostgreSQL.
   */
  private static async recordEngagement(userId: string, bookId: string, type: "DOWNLOAD" | "PREVIEW") {
    if (type === "DOWNLOAD") {
      await this.directRecordDownload(userId, bookId);
    } else {
      await this.directRecordPreview(userId, bookId);
    }
  }

  private static async directRecordPreview(userId: string, bookId: string) {
    try {
      // Atomic insert: relies on @@unique([userId, bookId]) constraint.
      // If the user already viewed, this insert will reject with P2002 and jump to catch.
      await prisma.$transaction([
        prisma.bookView.create({
          data: { userId, bookId },
        }),
        prisma.book.update({
          where: { id: bookId },
          data: { previewCount: { increment: 1 } },
        }),
      ]);
    } catch (err: any) {
      // P2002 is Prisma's unique constraint violation code (User already viewed)
      if (err.code === "P2002" || err.message?.includes("Unique constraint")) {
        await prisma.bookView.update({
          where: { userId_bookId: { userId, bookId } },
          data: { lastViewedAt: new Date() },
        }).catch(() => {});
      } else {
        console.error(`[storage] Failed to record book preview:`, err);
      }
    }
  }

  private static async directRecordDownload(userId: string, bookId: string) {
    try {
      // Atomic insert: relies on @@unique([userId, bookId]) constraint.
      // If the user already downloaded, this insert will reject with P2002 and jump to catch.
      await prisma.$transaction([
        prisma.bookDownload.create({
          data: { userId, bookId },
        }),
        prisma.book.update({
          where: { id: bookId },
          data: { downloadCount: { increment: 1 } },
        }),
      ]);
    } catch (err: any) {
      // P2002 is Prisma's unique constraint violation code (User already downloaded)
      if (err.code === "P2002" || err.message?.includes("Unique constraint")) {
        await prisma.bookDownload.update({
          where: { userId_bookId: { userId, bookId } },
          data: { lastDownloadedAt: new Date() },
        }).catch(() => {});
      } else {
        console.error(`[storage] Failed to record book download:`, err);
      }
    }
  }
}

export { BookType, BookStatus, FileFormat };
