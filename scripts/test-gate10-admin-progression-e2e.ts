// scripts/test-gate10-admin-progression-e2e.ts
//
// Gate 10 — admin progression reporting.

process.env.NODE_ENV = "test";
process.env.DISABLE_NOTIFICATION_WORKER = "true";

import "dotenv/config";
import http from "http";
import { AddressInfo } from "net";
import prisma from "../src/lib/prisma.js";
import { app } from "../src/app.js";
import { AdminAuthService } from "../src/services/adminAuthService.js";
import { AuthService } from "../src/services/authService.js";
import { getLagosCalendarDate } from "../src/lib/lagosTime.js";
import { StudentResourceStatus, StudentResourceType, FileFormat } from "../src/services/studentResourceService.js";
import { seedRankDefinitions } from "./seed-rank-definitions.js";
import { randomUUID } from "crypto";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ Assertion Failed: ${message}`);
    process.exitCode = 1;
    throw new Error(message);
  }
  console.log(`✅ Passed: ${message}`);
}

let resourceCounter = 0;

async function makeStudent(idPrefix: string, overrides: { name?: string; username?: string; email?: string } = {}) {
  const id = `${idPrefix}-${randomUUID().slice(0, 8)}`;
  const user = await prisma.user.create({
    data: {
      id,
      name: overrides.name ?? idPrefix,
      username: overrides.username ?? id,
      email: overrides.email ?? `${id}@miva.edu.ng`,
    },
  });
  const token = AuthService.generateAccessToken({ userId: user.id, email: user.email });
  return { user, token };
}

async function addApprovedContribution(userId: string, activityDate: Date) {
  resourceCounter += 1;
  const goal = await prisma.dailyGoal.upsert({
    where: { userId_activityDate: { userId, activityDate } },
    update: {},
    create: { userId, activityDate },
  });
  const resource = await prisma.studentResource.create({
    data: {
      userId,
      storageObjectId: randomUUID(),
      title: `Gate10 Resource #${resourceCounter}`,
      level: "100",
      department: "Computer Science",
      courseCode: "CSC101",
      courseTitle: "Intro to CS",
      resourceType: StudentResourceType.NOTE,
      fileFormat: FileFormat.PDF,
      status: StudentResourceStatus.APPROVED,
      approvedAt: new Date(),
    },
  });
  return prisma.resourceContribution.create({
    data: { studentResourceId: resource.id, dailyGoalId: goal.id },
  });
}

async function recalc(userId: string) {
  const { ProgressionService } = await import("../src/services/progressionService.js");
  await prisma.$transaction((tx) => ProgressionService.recalculateUserProgression(tx, userId));
}

async function runGate10Tests() {
  console.log("🧪 Starting Gate 10 Admin Progression Reporting Test Suite...\n");

  const rankCount = await prisma.rankDefinition.count();
  if (rankCount !== 10) {
    console.log("Seeding rank definitions before test...");
    await seedRankDefinitions();
  }

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  const BASE_URL = `http://127.0.0.1:${port}`;

  const testAdminId = `admin-gate10-${randomUUID().slice(0, 8)}`;
  const admin = await prisma.admin.create({
    data: {
      id: testAdminId,
      name: "Gate10 Admin",
      email: `${testAdminId}@miva.edu.ng`,
      password: await AdminAuthService.hashPassword("SuperSecret123!"),
      status: "ACTIVE",
    },
  });
  const adminToken = AdminAuthService.generateAccessToken({ adminId: admin.id, email: admin.email });

  const testUserIds: string[] = [];
  const today = getLagosCalendarDate(new Date());

  try {
    // -----------------------------------------------------------------------
    // Test 1: Admin authentication is enforced on both endpoints
    // -----------------------------------------------------------------------
    console.log("\n--- Test 1: Admin Authentication ---");

    const { user: student, token: studentToken } = await makeStudent("gate10-auth", {
      name: "Ada Lovelace",
      username: "ada-gate10",
      email: "ada-gate10@miva.edu.ng",
    });
    testUserIds.push(student.id);

    const unauthDetailRes = await fetch(`${BASE_URL}/api/admin/users/${student.id}/progression`);
    assert(unauthDetailRes.status === 401, "Unauthenticated GET /api/admin/users/:userId/progression returns 401");

    const unauthListRes = await fetch(`${BASE_URL}/api/admin/progression`);
    assert(unauthListRes.status === 401, "Unauthenticated GET /api/admin/progression returns 401");

    const studentDetailRes = await fetch(`${BASE_URL}/api/admin/users/${student.id}/progression`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    assert(studentDetailRes.status === 401, "Student token on GET .../progression (single user) returns 401");

    const studentListRes = await fetch(`${BASE_URL}/api/admin/progression`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    assert(studentListRes.status === 401, "Student token on GET /api/admin/progression (list) returns 401");

    const adminDetailRes = await fetch(`${BASE_URL}/api/admin/users/${student.id}/progression`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(adminDetailRes.status === 200, "Admin token on GET .../progression (single user) returns 200");

    const adminListRes = await fetch(`${BASE_URL}/api/admin/progression`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(adminListRes.status === 200, "Admin token on GET /api/admin/progression (list) returns 200");

    // -----------------------------------------------------------------------
    // Test 2: Unknown userId returns 404
    // -----------------------------------------------------------------------
    console.log("\n--- Test 2: Unknown User -> 404 ---");
    const notFoundRes = await fetch(`${BASE_URL}/api/admin/users/does-not-exist-${randomUUID().slice(0, 8)}/progression`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(notFoundRes.status === 404, "GET .../progression for a nonexistent userId returns 404");

    // -----------------------------------------------------------------------
    // Test 3: Single-user report — identity, daily goal, streak, rank, and
    // 7 recent daily records
    // -----------------------------------------------------------------------
    console.log("\n--- Test 3: Single User Progression Report ---");

    // 3 approved contributions today -> today's goal completed (100%).
    await addApprovedContribution(student.id, today);
    await addApprovedContribution(student.id, today);
    await addApprovedContribution(student.id, today);
    await recalc(student.id);

    const detailRes = await fetch(`${BASE_URL}/api/admin/users/${student.id}/progression`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(detailRes.status === 200, "Single-user report returns 200");
    const detail = (await detailRes.json()) as any;

    assert(detail.success === true, "Response has success: true");
    assert(
      detail.user.id === student.id && detail.user.name === "Ada Lovelace" && detail.user.username === "ada-gate10" && detail.user.email === "ada-gate10@miva.edu.ng",
      "Response includes the user's id, name, username, and email"
    );
    assert(
      detail.dailyGoal.activeCount === 3 && detail.dailyGoal.percentage === 100 && detail.dailyGoal.completed === true,
      "Response reports today's 3/3 completed daily goal"
    );
    assert(typeof detail.streak.current === "number" && typeof detail.streak.longest === "number", "Response includes streak.current and streak.longest");
    assert(
      detail.consistency.windowDays === 7 && typeof detail.consistency.percentage === "number",
      "Response includes a 7-day consistency window with a percentage"
    );
    assert(detail.rank.name === "Novice" && detail.rank.approvedResourceCount === 3, "Response includes rank name and approvedResourceCount");
    assert(detail.rank.nextRank && detail.rank.nextRank.name === "Amateur", "Response includes the next-rank structure");

    assert(Array.isArray(detail.recentDays) && detail.recentDays.length === 7, "Response includes exactly 7 recent daily records");
    const lastDay = detail.recentDays[detail.recentDays.length - 1];
    assert(lastDay.date === today.toISOString().slice(0, 10), "Last recent-day record is today");
    assert(lastDay.activeCount === 3 && lastDay.percentage === 100 && lastDay.completed === true, "Today's recent-day record shows 3 active / 100% / completed");
    const firstDay = detail.recentDays[0];
    assert(firstDay.activeCount === 0 && firstDay.percentage === 0 && firstDay.completed === false, "A day with no contributions reports 0 active / 0% / not completed, not a gap");
    for (const day of detail.recentDays) {
      assert(typeof day.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day.date), "Each recent-day record has a YYYY-MM-DD Lagos date");
    }

    // -----------------------------------------------------------------------
    // Test 4: Rank-level filtering on the list endpoint
    // -----------------------------------------------------------------------
    console.log("\n--- Test 4: Rank Filtering ---");

    const { user: highRankStudent } = await makeStudent("gate10-rank", {
      name: "Grace Hopper",
      username: "grace-gate10",
      email: "grace-gate10@miva.edu.ng",
    });
    testUserIds.push(highRankStudent.id);

    const amateurRank = await prisma.rankDefinition.findUniqueOrThrow({ where: { name: "Amateur" } });
    await prisma.userProgression.create({
      data: {
        userId: highRankStudent.id,
        rankId: amateurRank.id,
        approvedResourceCount: amateurRank.minimumApprovedResources,
        currentStreak: 0,
        longestStreak: 0,
      },
    });

    const rankFilterRes = await fetch(`${BASE_URL}/api/admin/progression?rankLevel=${amateurRank.level}&limit=100`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(rankFilterRes.status === 200, "Rank-filtered list returns 200");
    const rankFilterData = (await rankFilterRes.json()) as any;
    const rankFilterIds = rankFilterData.users.map((u: any) => u.id);
    assert(rankFilterIds.includes(highRankStudent.id), "Rank filter includes the Amateur-rank student");
    assert(!rankFilterIds.includes(student.id), "Rank filter excludes the Novice-rank student");
    assert(
      rankFilterData.users.every((u: any) => u.rank.level === amateurRank.level),
      "Every returned user matches the requested rank level"
    );

    // -----------------------------------------------------------------------
    // Test 5: Search by name, username, and email
    // -----------------------------------------------------------------------
    console.log("\n--- Test 5: Search ---");

    const searchByNameRes = await fetch(`${BASE_URL}/api/admin/progression?search=Grace Hopper`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const searchByNameData = (await searchByNameRes.json()) as any;
    assert(
      searchByNameData.users.some((u: any) => u.id === highRankStudent.id),
      "Search by full name finds the matching user"
    );

    const searchByUsernameRes = await fetch(`${BASE_URL}/api/admin/progression?search=ada-gate10`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const searchByUsernameData = (await searchByUsernameRes.json()) as any;
    assert(
      searchByUsernameData.users.some((u: any) => u.id === student.id),
      "Search by username finds the matching user"
    );

    const searchByEmailRes = await fetch(`${BASE_URL}/api/admin/progression?search=grace-gate10@miva.edu.ng`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const searchByEmailData = (await searchByEmailRes.json()) as any;
    assert(
      searchByEmailData.users.some((u: any) => u.id === highRankStudent.id),
      "Search by email finds the matching user"
    );

    const searchNoMatchRes = await fetch(`${BASE_URL}/api/admin/progression?search=${randomUUID()}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const searchNoMatchData = (await searchNoMatchRes.json()) as any;
    assert(searchNoMatchData.users.length === 0, "Search with no matches returns an empty list, not an error");

    // -----------------------------------------------------------------------
    // Test 6: Pagination
    // -----------------------------------------------------------------------
    console.log("\n--- Test 6: Pagination ---");

    const pageOneRes = await fetch(`${BASE_URL}/api/admin/progression?page=1&limit=1`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const pageOneData = (await pageOneRes.json()) as any;
    assert(pageOneData.users.length === 1, "limit=1 returns exactly 1 user");
    assert(pageOneData.pagination.page === 1 && pageOneData.pagination.limit === 1, "Pagination metadata echoes page and limit");
    assert(pageOneData.pagination.total >= 2, "Pagination total reflects at least the 2 seeded test users");

    const pageTwoRes = await fetch(`${BASE_URL}/api/admin/progression?page=2&limit=1`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const pageTwoData = (await pageTwoRes.json()) as any;
    assert(pageTwoData.users.length === 1, "Second page with limit=1 returns exactly 1 more user");
    assert(pageTwoData.users[0].id !== pageOneData.users[0].id, "Page 2 returns a different user than page 1");

    // -----------------------------------------------------------------------
    // Test 7: Response never leaks storage paths, signed URLs, passwords,
    // tokens, or storage object IDs
    // -----------------------------------------------------------------------
    console.log("\n--- Test 7: No Sensitive Fields Leaked ---");

    const forbiddenKeys = ["password", "storageObjectId", "signedUrl", "token", "accessToken", "refreshToken"];
    const listPayload = JSON.stringify(rankFilterData);
    const detailPayload = JSON.stringify(detail);
    for (const key of forbiddenKeys) {
      assert(!listPayload.includes(key), `List response never mentions "${key}"`);
      assert(!detailPayload.includes(key), `Single-user response never mentions "${key}"`);
    }

    console.log("\n🎉 All Gate 10 Admin Progression Reporting Scenarios Verified Successfully!\n");
  } finally {
    server.close();
    await prisma.resourceContribution.deleteMany({ where: { studentResource: { userId: { in: testUserIds } } } });
    await prisma.studentResource.deleteMany({ where: { userId: { in: testUserIds } } });
    await prisma.dailyGoal.deleteMany({ where: { userId: { in: testUserIds } } });
    await prisma.userProgression.deleteMany({ where: { userId: { in: testUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: testUserIds } } });
    await prisma.admin.deleteMany({ where: { id: testAdminId } });
    await prisma.$disconnect();
  }
}

runGate10Tests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("Gate 10 Test execution failed:", err);
    process.exit(1);
  });
