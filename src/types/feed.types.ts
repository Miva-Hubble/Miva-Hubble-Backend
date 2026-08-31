// src/types/feed.types.ts
//
// Single source of truth for the /api/feed response contract.
// All section loaders in feedService.ts return these types.

import type { BookType, FileFormat, PreferredMode } from "@prisma/client";

export type FeedSection =
  | "user"
  | "categories"
  | "trending"
  | "dailyGoal"
  | "topMasters"
  | "currentQuest"
  | "communityImpact";

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/**
 * Minimal book shape returned inside feed sections.
 * storageObjectId is intentionally excluded — it is an internal
 * implementation detail and must never be sent to the client.
 */
export interface BookCard {
  id: string;
  title: string;
  author: string;
  coverImageUrl: string | null;
  fileFormat: FileFormat;
  bookType: BookType;
  department: string;
  level: string;
  downloadCount: number;
  previewCount: number;
}

// ---------------------------------------------------------------------------
// Section payloads
// ---------------------------------------------------------------------------

export interface UserFeed {
  id: string;
  name: string;
  username: string;
  email: string;
  /** Google picture URL or uploaded profilePicturePath, whichever is set. */
  avatarUrl: string | null;
  level: string | null;
  department: string | null;
  goals: string[];
  preferredMode: PreferredMode;
  isOnboarded: boolean;
}

export interface CategoryGroup {
  bookType: BookType;
  count: number;
  books: BookCard[];
}

export interface CategoriesFeed {
  groups: CategoryGroup[];
}

export interface TrendingFeed {
  books: BookCard[];
  /**
   * Signals how trending was computed.
   * "recent" = createdAt DESC proxy (v1).
   * "views"  = future view-count column (v2).
   */
  basis: "recent" | "views";
}

export interface CommunityImpact {
  totalUsers: number;
  totalPublishedBooks: number;
  totalUploadedFiles: number;
}

// ---------------------------------------------------------------------------
// v1 stubs — sections with no schema support yet.
// Typed as null so the compiler enforces they never carry data
// until the real types are added.
// ---------------------------------------------------------------------------

export type DailyGoal = null;
export type TopMasters = null;
export type CurrentQuest = null;

// ---------------------------------------------------------------------------
// Top-level response
// ---------------------------------------------------------------------------

export interface FeedData {
  user: UserFeed | null;
  categories: CategoriesFeed | null;
  trending: TrendingFeed | null;
  dailyGoal: DailyGoal;
  topMasters: TopMasters;
  currentQuest: CurrentQuest;
  communityImpact: CommunityImpact | null;
}

export interface FeedMeta {
  /** true when at least one implemented section failed to load. */
  degraded: boolean;
  /** Sections that threw during this request. Stub nulls are NOT listed here. */
  failedSections: FeedSection[];
}

export interface FeedResponse {
  data: FeedData;
  meta: FeedMeta;
}
