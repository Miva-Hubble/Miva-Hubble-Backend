-- Migration: Add cover_image_url to books table
ALTER TABLE "public"."books" ADD COLUMN IF NOT EXISTS "cover_image_url" TEXT;
