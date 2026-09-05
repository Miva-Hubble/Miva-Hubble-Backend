// scripts/seed-rank-definitions.ts
//
// Seeds (or updates) the ten fixed progression ranks into rank_definitions.
// This is the only script that should ever write to that table's fixed
// ladder — see prisma/schema.prisma's RankDefinition comment.
//
// Idempotent: `level` is the stable unique lookup for each upsert, so
// rerunning this script updates the existing rows in place instead of
// creating duplicates. It never deletes rows, and it refuses to commit if
// the table doesn't end up with exactly ten rows.
//
// Usage:
//   pnpm seed:ranks

import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";

interface RankSeed {
  level: number;
  name: string;
  minimumApprovedResources: number;
}

// Fixed, ordered rank ladder (Novice -> Ultimate). `level` is the stable
// identity used for idempotent upserts — do not renumber existing levels
// without a migration plan, since UserProgression rows reference
// rank_definitions.id (not level) but the level itself is what admin
// tooling and any future rank-progression logic key off of.
const RANKS: RankSeed[] = [
  { level: 1, name: "Novice", minimumApprovedResources: 0 },
  { level: 2, name: "Amateur", minimumApprovedResources: 10 },
  { level: 3, name: "Senior", minimumApprovedResources: 20 },
  { level: 4, name: "Enthusiast", minimumApprovedResources: 30 },
  { level: 5, name: "Professional", minimumApprovedResources: 40 },
  { level: 6, name: "Expert", minimumApprovedResources: 50 },
  { level: 7, name: "Legend", minimumApprovedResources: 60 },
  { level: 8, name: "Veteran", minimumApprovedResources: 70 },
  { level: 9, name: "Master", minimumApprovedResources: 80 },
  { level: 10, name: "Ultimate", minimumApprovedResources: 90 },
];

export async function seedRankDefinitions(): Promise<void> {
  console.log(`\n🌱 Seeding ${RANKS.length} rank definitions (upsert by level)...`);

  await prisma.$transaction(async (tx) => {
    for (const rank of RANKS) {
      await tx.rankDefinition.upsert({
        where: { level: rank.level },
        update: {
          name: rank.name,
          minimumApprovedResources: rank.minimumApprovedResources,
        },
        create: {
          level: rank.level,
          name: rank.name,
          minimumApprovedResources: rank.minimumApprovedResources,
        },
      });
    }

    // This script never deletes rows, on purpose. But it must still fail
    // loudly — inside the transaction, so nothing partially commits — if
    // the table doesn't end up holding exactly the ten configured ranks
    // (e.g. a stray row left over from a bad manual insert).
    const total = await tx.rankDefinition.count();
    if (total !== RANKS.length) {
      throw new Error(
        `Expected exactly ${RANKS.length} rank_definitions rows after seeding, found ${total}. ` +
          `Refusing to commit — this script never deletes rows, so inspect the table manually.`
      );
    }
  });

  console.log(`✅ rank_definitions now has exactly ${RANKS.length} rows.`);
}

// CLI execution
if (process.argv[1]?.includes("seed-rank-definitions")) {
  seedRankDefinitions()
    .then(() => {
      console.log("Rank definitions seed finished successfully.");
    })
    .catch((err) => {
      console.error("❌ Rank definitions seed failed:", err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
