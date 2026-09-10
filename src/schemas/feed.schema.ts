// src/schemas/feed.schema.ts
//
// Runtime Zod schema validating the FeedResponse output boundary.
// Uses native Prisma enums to guarantee data integrity before sending.

import { z } from "zod";
import { BookType, FileFormat, Gender, PreferredMode } from "@prisma/client";

export const feedSectionSchema = z.enum([
  "user",
  "categories",
  "trending",
  "dailyGoal",
  "topMasters",
  "currentQuest",
  "communityImpact",
]);

export const bookCardSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  author: z.string(),
  coverImageUrl: z.string().nullable(),
  fileFormat: z.nativeEnum(FileFormat),
  bookType: z.nativeEnum(BookType),
  department: z.string(),
  level: z.string(),
  downloadCount: z.number().int().nonnegative(),
  previewCount: z.number().int().nonnegative(),
});

export const rankSummarySchema = z.object({
  level: z.number().int(),
  name: z.string(),
});

export const userFeedSchema = z.object({
  id: z.string(),
  name: z.string(),
  username: z.string(),
  email: z.string(),
  gender: z.nativeEnum(Gender).nullable(),
  level: z.string().nullable(),
  department: z.string().nullable(),
  goals: z.array(z.string()),
  preferredMode: z.nativeEnum(PreferredMode),
  isOnboarded: z.boolean(),
  rank: rankSummarySchema.nullable(),
});

export const categoryGroupSchema = z.object({
  bookType: z.nativeEnum(BookType),
  count: z.number().int().nonnegative(),
  books: z.array(bookCardSchema),
});

export const categoriesFeedSchema = z.object({
  groups: z.array(categoryGroupSchema),
});

export const trendingFeedSchema = z.object({
  books: z.array(bookCardSchema),
  basis: z.enum(["recent", "views"]),
});

export const communityImpactSchema = z.object({
  totalUsers: z.number().int().nonnegative(),
  totalPublishedBooks: z.number().int().nonnegative(),
  totalUploadedFiles: z.number().int().nonnegative(),
});

export const feedResponseSchema = z.object({
  data: z.object({
    user: userFeedSchema.nullable(),
    categories: categoriesFeedSchema.nullable(),
    trending: trendingFeedSchema.nullable(),
    dailyGoal: z.null(),
    topMasters: z.null(),
    currentQuest: z.null(),
    communityImpact: communityImpactSchema.nullable(),
  }),
  meta: z.object({
    degraded: z.boolean(),
    failedSections: z.array(feedSectionSchema),
  }),
});

export type FeedResponseSchema = z.infer<typeof feedResponseSchema>;
