// scripts/test-gate9-progress-endpoint.ts

process.env.NODE_ENV = "test";
process.env.DISABLE_NOTIFICATION_WORKER = "true";

import "dotenv/config";
import http from "http";
import { AddressInfo } from "net";
import prisma from "../src/lib/prisma.js";
import { app } from "../src/app.js";
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

async function makeStudent(idPrefix: string) {
  const id = `${idPrefix}-${randomUUID().slice(0, 8)}`;
  const user = await prisma.user.create({
    data: { id, name: idPrefix, username: id, email: `${id}@miva.edu.ng` },
  });
  const token = AuthService.generateAccessToken({ userId: user.id, email: user.email });
  return { user, token };
}

let resourceCounter = 0;

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
      title: `Gate9 Resource #${resourceCounter}`,
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

async function runGate9Tests() {
  console.log("🧪 Starting Gate 9 Student Progress Endpoint Test Suite...\n");

  const rankCount = await prisma.rankDefinition.count();
  if (rankCount !== 10) {
    console.log("Seeding rank definitions before test...");
    await seedRankDefinitions();
  }

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  const BASE_URL = `http://127.0.0.1:${port}`;

  const testUserIds: string[] = [];
  const today = getLagosCalendarDate(new Date());

  try {
    // -----------------------------------------------------------------------
    // Test 1: Unauthenticated request -> 401
    // -----------------------------------------------------------------------
    console.log("\n--- Test 1: Unauthenticated Request ---");
    const unauthRes = await fetch(`${BASE_URL}/api/student-resources/progress`);
    assert(unauthRes.status === 401, "Unauthenticated GET /api/student-resources/progress returns 401");

    // -----------------------------------------------------------------------
    // Test 2: No UserProgression yet -> Novice-equivalent, no record created
    // -----------------------------------------------------------------------
    console.log("\n--- Test 2: Novice-Equivalent Default (No UserProgression Row) ---");
    const { user: freshUser, token: freshToken } = await makeStudent("gate9-fresh");
    testUserIds.push(freshUser.id);

    const freshRes = await fetch(`${BASE_URL}/api/student-resources/progress`, {
      headers: { Authorization: `Bearer ${freshToken}` },
    });
    assert(freshRes.status === 200, "Authenticated request with no history returns 200");
    const freshData = (await freshRes.json()) as any;
    assert(freshData.rank.name === "Novice" && freshData.rank.approvedResourceCount === 0, "No history -> Novice-equivalent rank");
    assert(freshData.dailyGoal.activeCount === 0 && freshData.dailyGoal.percentage === 0, "No history -> 0% daily goal");
    assert(freshData.streak.current === 0 && freshData.streak.longest === 0, "No history -> zero streaks");
    assert(
      freshData.rank.nextRank && freshData.rank.nextRank.name === "Amateur",
      "Novice-equivalent still reports Amateur as the next rank"
    );

    const noProgressionRow = await prisma.userProgression.findUnique({ where: { userId: freshUser.id } });
    assert(noProgressionRow === null, "Reading progress with no history does NOT create a UserProgression row");

    // -----------------------------------------------------------------------
    // Test 3: Student cannot read another student's progress
    // -----------------------------------------------------------------------
    console.log("\n--- Test 3: Cross-User Isolation ---");
    const { user: studentA, token: tokenA } = await makeStudent("gate9-student-a");
    const { user: studentB, token: tokenB } = await makeStudent("gate9-student-b");
    testUserIds.push(studentA.id, studentB.id);

    // Give A 3 completed contributions today; B has none.
    await addApprovedContribution(studentA.id, today);
    await addApprovedContribution(studentA.id, today);
    await addApprovedContribution(studentA.id, today);

    const resA = await (await fetch(`${BASE_URL}/api/student-resources/progress`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    })).json() as any;
    const resB = await (await fetch(`${BASE_URL}/api/student-resources/progress`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    })).json() as any;

    assert(resA.dailyGoal.activeCount === 3 && resA.dailyGoal.completed === true, "Student A's token returns A's own 3/3 completed goal");
    assert(resB.dailyGoal.activeCount === 0 && resB.dailyGoal.completed === false, "Student B's token returns B's own empty goal, never A's");
    assert(resB.rank.approvedResourceCount === 0, "Student B's token never leaks A's approvedResourceCount");

    // No userId can be smuggled in via query/body — the route has no :id and
    // the handler never reads req.query/req.body for identity, only the
    // verified token. Confirm a spoofed query param is simply ignored.
    const spoofRes = await (await fetch(`${BASE_URL}/api/student-resources/progress?userId=${studentA.id}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    })).json() as any;
    assert(spoofRes.dailyGoal.activeCount === 0, "A spoofed ?userId= query param is ignored — B still sees only B's own data");

    // -----------------------------------------------------------------------
    // Test 4: Daily goal 0/33/66/100 progression, live via the endpoint
    // -----------------------------------------------------------------------
    console.log("\n--- Test 4: Daily Goal 0/33/66/100 States ---");
    const { user: studentC, token: tokenC } = await makeStudent("gate9-daily");
    testUserIds.push(studentC.id);

    const getProgress = async (token: string) =>
      (await (
        await fetch(`${BASE_URL}/api/student-resources/progress`, { headers: { Authorization: `Bearer ${token}` } })
      ).json()) as any;

    let dataC = await getProgress(tokenC);
    assert(dataC.dailyGoal.percentage === 0 && !dataC.dailyGoal.completed, "0 contributions -> 0%, not completed");

    await addApprovedContribution(studentC.id, today);
    dataC = await getProgress(tokenC);
    assert(dataC.dailyGoal.percentage === 33 && !dataC.dailyGoal.completed, "1 contribution -> 33%, not completed");

    await addApprovedContribution(studentC.id, today);
    dataC = await getProgress(tokenC);
    assert(dataC.dailyGoal.percentage === 66 && !dataC.dailyGoal.completed, "2 contributions -> 66%, not completed");

    await addApprovedContribution(studentC.id, today);
    dataC = await getProgress(tokenC);
    assert(dataC.dailyGoal.percentage === 100 && dataC.dailyGoal.completed, "3 contributions -> 100%, completed");
    assert(dataC.dailyGoal.target === 3, "target is always 3");

    // -----------------------------------------------------------------------
    // Test 5: Ultimate rank has no next rank
    // -----------------------------------------------------------------------
    console.log("\n--- Test 5: Ultimate Rank Has No Next Rank ---");
    const { user: studentUltimate, token: tokenUltimate } = await makeStudent("gate9-ultimate");
    testUserIds.push(studentUltimate.id);

    const ultimateRank = await prisma.rankDefinition.findUniqueOrThrow({ where: { name: "Ultimate" } });
    await prisma.userProgression.create({
      data: {
        userId: studentUltimate.id,
        rankId: ultimateRank.id,
        approvedResourceCount: 95,
        currentStreak: 0,
        longestStreak: 0,
      },
    });

    const ultimateData = await getProgress(tokenUltimate);
    assert(ultimateData.rank.name === "Ultimate" && ultimateData.rank.level === 10, "Rank resolves to Ultimate");
    assert(ultimateData.rank.nextRank === null, "Ultimate rank reports nextRank: null");

    console.log("\n🎉 All Gate 9 Student Progress Endpoint Scenarios Verified Successfully!\n");
  } finally {
    server.close();
    await prisma.resourceContribution.deleteMany({ where: { studentResource: { userId: { in: testUserIds } } } });
    await prisma.studentResource.deleteMany({ where: { userId: { in: testUserIds } } });
    await prisma.dailyGoal.deleteMany({ where: { userId: { in: testUserIds } } });
    await prisma.userProgression.deleteMany({ where: { userId: { in: testUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: testUserIds } } });
    await prisma.$disconnect();
  }
}

runGate9Tests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("Gate 9 Test execution failed:", err);
    process.exit(1);
  });
