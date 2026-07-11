import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // CLI-only (migrate/generate/studio). Runtime PrismaClient in src/lib/prisma.ts
    // uses DATABASE_URL (pooled) separately via the pg adapter — unaffected by this.
    url: process.env.DIRECT_URL || process.env.DATABASE_URL || "postgresql://mock:mock@localhost:5432/mock",
  },
});
