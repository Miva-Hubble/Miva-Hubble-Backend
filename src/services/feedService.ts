// src/services/feedService.ts
//
// Independent section loaders for GET /api/feed.
// Each loader is a standalone async function — adding a new section in v2
// means adding a new function and wiring it into getFeed(), with zero impact
// on existing loaders.
//
// getFeed() runs all implemented sections concurrently via Promise.allSettled
// so one failing section never kills the rest of the response.

import prisma from "../lib/prisma.js";
import { BookStatus, BookType, PreferredMode } from "@prisma/client";
import { TARGETING_WILDCARD } from "../constants/taxonomy.js";
import type {
  FeedSection,
  FeedResponse,
  UserFeed,
  CategoriesFeed,
  CategoryGroup,
  TrendingFeed,
  CommunityImpact,
  BookCard,
} from "../types/feed.types.js";
import { feedResponseSchema } from "../schemas/feed.schema.js";

// Number of books returned in the trending section.
const TRENDING_LIMIT = 10;

// Internal context type for targeting and profile metadata
export interface FeedContext {
  userId: string;
  level: string | null;
  department: string | null;
}

// Prisma select that produces a BookCard — storageObjectId is intentionally
// absent. Keep this in sync with the BookCard interface in feed.types.ts.
const BOOK_CARD_SELECT = {
  id: true,
  title: true,
  author: true,
  coverImageUrl: true,
  fileFormat: true,
  bookType: true,
  department: true,
  level: true,
  downloadCount: true,
  previewCount: true,
} as const;

// ---------------------------------------------------------------------------
// Targeting helpers
// ---------------------------------------------------------------------------

/**
 * Returns the Prisma WHERE clause that matches books relevant to the student.
 * When onboarding is absent the filter still works — it just returns nothing
 * because no level/department can match undefined values.
 */
function buildTargetingWhere(level?: string | null, department?: string | null) {
  return {
    status: BookStatus.PUBLISHED,
    AND: [
      {
        OR: [
          { level: level ?? "__no_match__" },
          { level: TARGETING_WILDCARD },
        ],
      },
      {
        OR: [
          { department: { equals: department ?? "__no_match__", mode: "insensitive" as const } },
          { department: TARGETING_WILDCARD },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Context Loader
// ---------------------------------------------------------------------------

export async function getUserContext(userId: string): Promise<FeedContext> {
  const onboarding = await prisma.onboarding.findUnique({
    where: { userId },
    select: { level: true, department: true },
  });

  return {
    userId,
    level: onboarding?.level ?? null,
    department: onboarding?.department ?? null,
  };
}

// ---------------------------------------------------------------------------
// Section: user
// ---------------------------------------------------------------------------

export async function getUser(userId: string): Promise<UserFeed> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
      picture: true,
      profilePicturePath: true,
      onboarding: {
        select: {
          level: true,
          department: true,
          goals: true,
          preferredMode: true,
        },
      },
    },
  });

  if (!user) throw new Error("User not found");

  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    // profilePicturePath (uploaded avatar) takes precedence over the Google
    // OAuth picture; fall back to picture if no custom upload exists.
    avatarUrl: user.profilePicturePath ?? user.picture ?? null,
    level: user.onboarding?.level ?? null,
    department: user.onboarding?.department ?? null,
    goals: user.onboarding?.goals ?? [],
    preferredMode: user.onboarding?.preferredMode ?? PreferredMode.ANONYMOUS,
    isOnboarded: user.onboarding !== null,
  };
}

// ---------------------------------------------------------------------------
// Section: categories
// ---------------------------------------------------------------------------

export async function getCategories(ctx: FeedContext): Promise<CategoriesFeed> {
  const where = buildTargetingWhere(ctx.level, ctx.department);

  const books = await prisma.book.findMany({
    where,
    select: BOOK_CARD_SELECT,
    orderBy: { createdAt: "desc" },
  });

  // Group by bookType in memory
  const grouped = new Map<BookType, BookCard[]>();
  for (const book of books) {
    const list = grouped.get(book.bookType) ?? [];
    list.push({
      id: book.id,
      title: book.title,
      author: book.author,
      coverImageUrl: book.coverImageUrl,
      fileFormat: book.fileFormat,
      bookType: book.bookType,
      department: book.department,
      level: book.level,
      downloadCount: book.downloadCount,
      previewCount: book.previewCount,
    });
    grouped.set(book.bookType, list);
  }

  const groups: CategoryGroup[] = Array.from(grouped.entries()).map(
    ([bookType, items]) => ({
      bookType,
      count: items.length,
      books: items,
    })
  );

  return { groups };
}

// ---------------------------------------------------------------------------
// Section: trending
// ---------------------------------------------------------------------------

export async function getTrending(ctx: FeedContext): Promise<TrendingFeed> {
  const where = buildTargetingWhere(ctx.level, ctx.department);

  const books = await prisma.book.findMany({
    where,
    select: BOOK_CARD_SELECT,
    orderBy: { createdAt: "desc" },
    take: TRENDING_LIMIT,
  });

  return {
    books: books.map((b) => ({
      id: b.id,
      title: b.title,
      author: b.author,
      coverImageUrl: b.coverImageUrl,
      fileFormat: b.fileFormat,
      bookType: b.bookType,
      department: b.department,
      level: b.level,
      downloadCount: b.downloadCount,
      previewCount: b.previewCount,
    })),
    basis: "recent",
  };
}

// ---------------------------------------------------------------------------
// Section: communityImpact
// ---------------------------------------------------------------------------

export async function getCommunityImpact(): Promise<CommunityImpact> {
  // $transaction ensures the counts are read from a consistent snapshot.
  const [totalUsers, totalPublishedBooks, totalUploadedFiles] =
    await prisma.$transaction([
      prisma.user.count(),
      prisma.book.count({ where: { status: BookStatus.PUBLISHED } }),
      prisma.userFile.count({ where: { isArchived: false } }),
    ]);

  return { totalUsers, totalPublishedBooks, totalUploadedFiles };
}

// ---------------------------------------------------------------------------
// v1 stubs — wired now so getFeed() shape stays stable across versions.
// Replace the return value with a real query when the schema is ready.
// ---------------------------------------------------------------------------

export async function getDailyGoal(): Promise<null> {
  return null;
}

export async function getTopMasters(): Promise<null> {
  return null;
}

export async function getCurrentQuest(): Promise<null> {
  return null;
}

// ---------------------------------------------------------------------------
// Observability Wrapper
// ---------------------------------------------------------------------------

async function executeSection<T>(
  section: FeedSection,
  userId: string,
  loader: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await loader();
    const durationMs = Date.now() - startedAt;
    console.info(
      `[feed] section="${section}" userId="${userId}" status="success" durationMs=${durationMs}`
    );
    return result;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(
      `[feed] section="${section}" userId="${userId}" status="failed" durationMs=${durationMs} error="${errorMsg}"`
    );
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Runs all implemented feed sections concurrently. A section that throws is
 * recorded in meta.failedSections and its data slot is set to null — the
 * other sections are unaffected and the HTTP status is always 200.
 *
 * Stub sections (dailyGoal / topMasters / currentQuest) are called but their
 * null return is NEVER added to failedSections — null is their correct v1
 * value, not a failure.
 */
export async function getFeed(userId: string): Promise<FeedResponse> {
  const feedStartedAt = Date.now();
  const failedSections: FeedSection[] = [];

  // 1. Fetch onboarding context once safely (defaults to empty context on failure)
  const contextPromise = getUserContext(userId).catch((err) => {
    console.error(`[feed] Failed to load onboarding context for userId="${userId}":`, err);
    return { userId, level: null, department: null };
  });

  // 2. Run sections concurrently with timing/logging wrappers
  const [userResult, categoriesResult, trendingResult, communityResult] =
    await Promise.allSettled([
      executeSection("user", userId, () => getUser(userId)),
      executeSection("categories", userId, () =>
        contextPromise.then((ctx) => getCategories(ctx))
      ),
      executeSection("trending", userId, () =>
        contextPromise.then((ctx) => getTrending(ctx))
      ),
      executeSection("communityImpact", userId, () => getCommunityImpact()),
    ]);

  function settle<T>(
    result: PromiseSettledResult<T>,
    section: FeedSection
  ): T | null {
    if (result.status === "fulfilled") return result.value;
    failedSections.push(section);
    return null;
  }

  const response: FeedResponse = {
    data: {
      user: settle(userResult, "user"),
      categories: settle(categoriesResult, "categories"),
      trending: settle(trendingResult, "trending"),
      communityImpact: settle(communityResult, "communityImpact"),
      // Stubs — always null in v1; intentionally not run through settle()
      // so they never appear in failedSections.
      dailyGoal: null,
      topMasters: null,
      currentQuest: null,
    },
    meta: {
      degraded: failedSections.length > 0,
      failedSections,
    },
  };

  const totalDurationMs = Date.now() - feedStartedAt;
  console.info(
    `[feed] completed userId="${userId}" durationMs=${totalDurationMs} degraded=${response.meta.degraded}`
  );

  // Step 8: Strict runtime schema validation boundary.
  // Rejects malformed internal objects or invalid failedSections with a 500 error.
  return feedResponseSchema.parse(response);
}
