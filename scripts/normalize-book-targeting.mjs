import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

dotenv.config();

const DEPARTMENTS = [
  "Computer Science",
  "Engineering",
  "Business",
  "Medicine",
  "Arts",
  "Information Technology",
  "Data Science",
  "Cybersecurity",
];

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const canonicalByLowercase = new Map(DEPARTMENTS.map((d) => [d.toLowerCase(), d]));

async function main() {
  const books = await prisma.book.findMany({
    where: { department: { notIn: [...DEPARTMENTS, "All"] } },
  });

  for (const book of books) {
    const canonical = canonicalByLowercase.get(book.department.trim().toLowerCase());
    if (!canonical) {
      console.warn(`No canonical match for book ${book.id}: "${book.department}" — needs manual review`);
      continue;
    }
    await prisma.book.update({ where: { id: book.id }, data: { department: canonical } });
    console.log(`Fixed ${book.id}: "${book.department}" -> "${canonical}"`);
  }
}

main()
  .catch((err) => {
    console.error("Failed to normalize book targeting:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
