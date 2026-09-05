// scripts/test-gate7-e2e.ts

process.env.NODE_ENV = "test";
process.env.DISABLE_NOTIFICATION_WORKER = "true";

import "dotenv/config";
import http from "http";
import { AddressInfo } from "net";
import prisma from "../src/lib/prisma.js";
import { app } from "../src/app.js";
import {
  StudentResourceStatus,
  StudentResourceType,
  FileFormat,
} from "../src/services/studentResourceService.js";
import { AdminAuthService } from "../src/services/adminAuthService.js";
import { AuthService } from "../src/services/authService.js";
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

async function runGate7HttpTests() {
  console.log("🧪 Starting Gate 7 Admin Moderation HTTP API Integration Test Suite...\n");

  // 0. Ensure Rank Definitions exist in database
  const rankCount = await prisma.rankDefinition.count();
  if (rankCount !== 10) {
    console.log("Seeding rank definitions before test...");
    await seedRankDefinitions();
  }

  // 1. Start test server on random available port
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  const BASE_URL = `http://127.0.0.1:${port}`;

  const testAdminId = `admin-test-${randomUUID().slice(0, 8)}`;
  const testUserId = `student-test-${randomUUID().slice(0, 8)}`;

  // Create test Admin (ACTIVE)
  const admin = await prisma.admin.create({
    data: {
      id: testAdminId,
      name: "Gate7 Moderator",
      email: `${testAdminId}@miva.edu.ng`,
      password: await AdminAuthService.hashPassword("SuperSecret123!"),
      status: "ACTIVE",
    },
  });

  // Create test Student User
  const student = await prisma.user.create({
    data: {
      id: testUserId,
      name: "Gate7 Student",
      username: testUserId,
      email: `${testUserId}@miva.edu.ng`,
    },
  });

  const adminToken = AdminAuthService.generateAccessToken({
    adminId: admin.id,
    email: admin.email,
  });

  const studentToken = AuthService.generateAccessToken({
    userId: student.id,
    email: student.email,
  });

  try {
    // -----------------------------------------------------------------------
    // Test 1: Student token receives 401 on admin routes
    // -----------------------------------------------------------------------
    console.log("\n--- Test 1: Admin Auth Middleware Protection ---");

    // Unauthenticated
    const unauthRes = await fetch(`${BASE_URL}/api/admin/student-resources`);
    assert(unauthRes.status === 401, "Unauthenticated request to GET /api/admin/student-resources returns 401");

    // Student token attempting to access admin route
    const studentAuthRes = await fetch(`${BASE_URL}/api/admin/student-resources`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    assert(studentAuthRes.status === 401, "Student token attempting GET /api/admin/student-resources returns 401");

    // Student token attempting review
    const studentReviewRes = await fetch(`${BASE_URL}/api/admin/student-resources/${randomUUID()}/review`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${studentToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "APPROVE" }),
    });
    assert(studentReviewRes.status === 401, "Student token attempting PATCH review returns 401");

    // -----------------------------------------------------------------------
    // Test 2: Admin queue list with PENDING_REVIEW and pagination
    // -----------------------------------------------------------------------
    console.log("\n--- Test 2: Admin Queue Listing with PENDING_REVIEW & Pagination ---");

    // Seed test resources: 1 DRAFT, 2 PENDING_REVIEW
    const draftRes = await prisma.studentResource.create({
      data: {
        userId: student.id,
        storageObjectId: randomUUID(),
        title: "DRAFT Material",
        level: "100",
        department: "Computer Science",
        courseCode: "CSC101",
        courseTitle: "Intro to CS",
        resourceType: StudentResourceType.NOTE,
        fileFormat: FileFormat.PDF,
        status: StudentResourceStatus.DRAFT,
      },
    });

    const pendingRes1 = await prisma.studentResource.create({
      data: {
        userId: student.id,
        storageObjectId: randomUUID(),
        title: "Pending Resource 1 (To Reject)",
        level: "200",
        department: "Software Eng.",
        courseCode: "SEN201",
        courseTitle: "Software Architecture",
        resourceType: StudentResourceType.STUDY_GUIDE,
        fileFormat: FileFormat.PDF,
        status: StudentResourceStatus.PENDING_REVIEW,
        submittedAt: new Date(Date.now() - 5000),
      },
    });

    const pendingRes2 = await prisma.studentResource.create({
      data: {
        userId: student.id,
        storageObjectId: randomUUID(),
        title: "Pending Resource 2 (To Approve)",
        level: "300",
        department: "Cybersecurity",
        courseCode: "CYB301",
        courseTitle: "Network Defense",
        resourceType: StudentResourceType.PAST_QUESTION,
        fileFormat: FileFormat.DOCX,
        status: StudentResourceStatus.PENDING_REVIEW,
        submittedAt: new Date(),
      },
    });

    // Submitted 7 hours ago — past the 6-hour PENDING_REVIEW SLA (layer 1:
    // read-time overdue flag, no new status, no stored due-date column).
    const overdueRes = await prisma.studentResource.create({
      data: {
        userId: student.id,
        storageObjectId: randomUUID(),
        title: "Overdue Pending Resource",
        level: "400",
        department: "Engineering",
        courseCode: "ENG401",
        courseTitle: "Thermodynamics",
        resourceType: StudentResourceType.NOTE,
        fileFormat: FileFormat.PDF,
        status: StudentResourceStatus.PENDING_REVIEW,
        submittedAt: new Date(Date.now() - 7 * 60 * 60 * 1000),
      },
    });

    const queueRes = await fetch(
      `${BASE_URL}/api/admin/student-resources?status=PENDING_REVIEW&page=1&limit=10`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
      }
    );
    assert(queueRes.status === 200, "Admin receives 200 OK for GET /api/admin/student-resources");

    const queueData = (await queueRes.json()) as any;
    assert(queueData.success === true, "Response has success: true");
    assert(Array.isArray(queueData.resources), "Response contains resources array");
    assert(queueData.pagination && queueData.pagination.page === 1, "Response contains valid pagination metadata");

    const queueResourceIds = queueData.resources.map((r: any) => r.id);
    assert(queueResourceIds.includes(pendingRes1.id), "Pending queue contains Pending Resource 1");
    assert(queueResourceIds.includes(pendingRes2.id), "Pending queue contains Pending Resource 2");
    assert(!queueResourceIds.includes(draftRes.id), "Pending queue excludes DRAFT resources");

    // -----------------------------------------------------------------------
    // Test 2b: Layer 1 SLA flag — isOverdue/hoursWaiting on PENDING_REVIEW rows
    // -----------------------------------------------------------------------
    console.log("\n--- Test 2b: PENDING_REVIEW SLA Flag (isOverdue / hoursWaiting) ---");

    const freshRow = queueData.resources.find((r: any) => r.id === pendingRes2.id);
    const overdueRow = queueData.resources.find((r: any) => r.id === overdueRes.id);

    assert(freshRow.isOverdue === false, "Just-submitted resource is not overdue");
    assert(typeof freshRow.hoursWaiting === "number" && freshRow.hoursWaiting < 1, "Just-submitted resource reports <1h waiting");

    assert(overdueRow.isOverdue === true, "Resource submitted 7h ago (>6h SLA) is flagged overdue");
    assert(overdueRow.hoursWaiting > 6, "Overdue resource reports hoursWaiting > 6");

    // A resolved (non-PENDING_REVIEW) resource must never report overdue,
    // regardless of how old its submittedAt is — it's not waiting on anyone.
    const allStatusesRes = await fetch(`${BASE_URL}/api/admin/student-resources?page=1&limit=50`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const allStatusesData = (await allStatusesRes.json()) as any;
    const draftRow = allStatusesData.resources.find((r: any) => r.id === draftRes.id);
    assert(draftRow.isOverdue === false && draftRow.hoursWaiting === null, "Non-PENDING_REVIEW resource reports isOverdue: false, hoursWaiting: null");

    // -----------------------------------------------------------------------
    // Test 3: Rejected review without a reason returns 400
    // -----------------------------------------------------------------------
    console.log("\n--- Test 3: Reject Review Validation (Missing Reason -> 400) ---");
    console.log("(Note: Below 'Validation Error' is the expected server log for testing missing reason)");

    const rejectNoReasonRes = await fetch(
      `${BASE_URL}/api/admin/student-resources/${pendingRes1.id}/review`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${adminToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "REJECT" }),
      }
    );
    assert(
      rejectNoReasonRes.status === 400,
      "PATCH review with action: REJECT and no reason returns 400 Bad Request"
    );

    const rejectNoReasonData = (await rejectNoReasonRes.json()) as any;
    const errorsStr = JSON.stringify(rejectNoReasonData);
    assert(
      errorsStr.includes("Rejection requires a reason") || errorsStr.includes("Validation failed"),
      "Error response indicates rejection requires a reason"
    );

    // Valid REJECT with reason
    const rejectWithReasonRes = await fetch(
      `${BASE_URL}/api/admin/student-resources/${pendingRes1.id}/review`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${adminToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "REJECT",
          reason: "Low scan quality and missing citations",
        }),
      }
    );
    assert(rejectWithReasonRes.status === 200, "Valid rejection with reason returns 200 OK");
    const rejectedData = (await rejectWithReasonRes.json()) as any;
    assert(rejectedData.resource.status === StudentResourceStatus.REJECTED, "Resource status updated to REJECTED");
    assert(
      rejectedData.resource.rejectionReason === "Low scan quality and missing citations",
      "Rejection reason stored"
    );

    // Verify rejection produced NO ledger contribution
    const noContrib = await prisma.resourceContribution.findUnique({
      where: { studentResourceId: pendingRes1.id },
    });
    assert(noContrib === null, "Rejection created NO ResourceContribution row");

    // -----------------------------------------------------------------------
    // Test 4: Approve via actual API route (PATCH)
    // -----------------------------------------------------------------------
    console.log("\n--- Test 4: Approve via PATCH /api/admin/student-resources/:id/review ---");

    const approveRes = await fetch(
      `${BASE_URL}/api/admin/student-resources/${pendingRes2.id}/review`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${adminToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "APPROVE" }),
      }
    );
    assert(approveRes.status === 200, "PATCH review with action: APPROVE returns 200 OK");

    const approveData = (await approveRes.json()) as any;
    assert(approveData.resource.status === StudentResourceStatus.APPROVED, "Resource status transitioned to APPROVED");
    assert(approveData.resource.approvedAt !== null, "Resource recorded approvedAt timestamp");
    assert(approveData.resource.reviewedByAdminId === admin.id, "Resource recorded reviewer adminId");

    // Verify DB ledger contribution + DailyGoal + UserProgression
    const contribution = await prisma.resourceContribution.findUnique({
      where: { studentResourceId: pendingRes2.id },
      include: { dailyGoal: true },
    });
    assert(contribution !== null, "ResourceContribution ledger entry created");
    assert(contribution!.dailyGoal.userId === student.id, "DailyGoal correctly linked to student");

    const progression = await prisma.userProgression.findUnique({
      where: { userId: student.id },
      include: { rank: true },
    });
    assert(progression !== null, "UserProgression row updated for student");
    assert(progression!.approvedResourceCount === 1, "approvedResourceCount incremented to 1");
    assert(progression!.rank.level === 1, "Student assigned rank Level 1 (Novice)");

    // -----------------------------------------------------------------------
    // Test 5: Duplicate approval returns 409
    // -----------------------------------------------------------------------
    console.log("\n--- Test 5: Duplicate Approval Guard (Returns 409 Conflict) ---");

    const duplicateApproveRes = await fetch(
      `${BASE_URL}/api/admin/student-resources/${pendingRes2.id}/review`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${adminToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "APPROVE" }),
      }
    );
    assert(
      duplicateApproveRes.status === 409,
      "Second approval on already APPROVED resource returns 409 Conflict"
    );

    // -----------------------------------------------------------------------
    // Test 6: Archive via actual API route (PATCH) & Revocation
    // -----------------------------------------------------------------------
    console.log("\n--- Test 6: Archive via PATCH /api/admin/student-resources/:id/archive ---");

    const archiveRes = await fetch(
      `${BASE_URL}/api/admin/student-resources/${pendingRes2.id}/archive`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${adminToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reason: "Plagiarism detected post-approval",
        }),
      }
    );
    assert(archiveRes.status === 200, "PATCH archive returns 200 OK");

    const archiveData = (await archiveRes.json()) as any;
    assert(archiveData.resource.status === StudentResourceStatus.ARCHIVED, "Resource status transitioned to ARCHIVED");

    // Verify contribution was revoked in DB, not deleted
    const revokedContribution = await prisma.resourceContribution.findUnique({
      where: { studentResourceId: pendingRes2.id },
    });
    assert(revokedContribution !== null, "ResourceContribution was preserved in database");
    assert(revokedContribution!.revokedAt !== null, "ResourceContribution stamped with revokedAt");
    assert(
      revokedContribution!.revocationReason === "Plagiarism detected post-approval",
      "ResourceContribution stamped with revocationReason"
    );

    // Verify progression recalculated: approved count dropped to 0
    const progressionAfterArchive = await prisma.userProgression.findUnique({
      where: { userId: student.id },
    });
    assert(
      progressionAfterArchive!.approvedResourceCount === 0,
      "approvedResourceCount successfully recomputed back to 0"
    );

    console.log("\n🎉 All Gate 7 HTTP API Endpoints, Middlewares & Scenarios Verified Successfully!\n");
  } finally {
    server.close();

    // Clean up test data
    await prisma.resourceContribution.deleteMany({
      where: { studentResource: { userId: testUserId } },
    });
    await prisma.studentResource.deleteMany({
      where: { userId: testUserId },
    });
    await prisma.dailyGoal.deleteMany({
      where: { userId: testUserId },
    });
    await prisma.userProgression.deleteMany({
      where: { userId: testUserId },
    });
    await prisma.user.deleteMany({
      where: { id: testUserId },
    });
    await prisma.admin.deleteMany({
      where: { id: testAdminId },
    });
    await prisma.$disconnect();
  }
}

runGate7HttpTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("Gate 7 HTTP Test execution failed:", err);
    process.exit(1);
  });
