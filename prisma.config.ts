import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // CLI-only (migrate/generate/studio). Runtime PrismaClient in src/lib/prisma.ts
    // uses DATABASE_URL (pooled) separately via the pg adapter — unaffected by this.
    url: env("DIRECT_URL"),
  },
});
