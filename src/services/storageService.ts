// services/storageService.ts

import { randomUUID } from "crypto";
import prisma from "../lib/prisma.js";
import { supabaseAdmin } from "../config/supabase.js";
import { BookType, BookStatus, Prisma } from "@prisma/client";
import type { CreateBookInput, UpdateBookInput } from "../schemas/storage.schema.js";

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "resources";

const USER_FILES_PREFIX = (userId: string) => `users/${userId}/`;
const BOOKS_PREFIX = "books/global/";

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

    // No onboarding profile yet => nothing to target against. Return an
    // empty feed rather than guessing, per the "no general noise" rule.
    if (!onboarding) return [];

    return prisma.book.findMany({
      where: {
        status: BookStatus.PUBLISHED,
        AND: [
          { OR: [{ level: onboarding.level }, { level: "All" }] },
          { OR: [{ department: onboarding.department }, { department: "All" }] },
          {
            OR: [
              { tags: { hasSome: onboarding.goals } },
              { tags: { has: "All" } },
              // Untagged books reach the whole matching level+department,
              // per the "Leave empty to reach the whole department + level"
              // rule shown in the admin upload UI.
              { tags: { isEmpty: true } },
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
    expiresIn = DEFAULT_DOWNLOAD_URL_TTL_SECONDS,
  ) {
    let storageObjectId: string;

    if (isBook) {
      const book = await prisma.book.findFirst({
        where: { id: assetId, status: BookStatus.PUBLISHED },
      });
      if (!book) throw new Error("Book not found or unavailable");
      storageObjectId = book.storageObjectId;
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
      .createSignedUrl(location.name, expiresIn, { download: true });

    if (error || !data?.signedUrl) {
      throw new Error(error?.message || "Failed to generate download URL");
    }

    return data.signedUrl;
  }
}

export { BookType, BookStatus };
