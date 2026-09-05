// scripts/test-student-resources-e2e.ts

import "dotenv/config";
import prisma from "../src/lib/prisma.js";
import { StudentResourceService, StudentResourceStatus, StudentResourceType, FileFormat } from "../src/services/studentResourceService.js";
import { randomUUID } from "crypto";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ Assertion Failed: ${message}`);
    process.exitCode = 1;
    throw new Error(message);
  }
  console.log(`✅ Passed: ${message}`);
}

async function runE2ETests() {
  console.log("🧪 Starting Gate 6 End-to-End Integration Verification...\n");

  const testUserA = `test-user-a-${randomUUID().slice(0, 8)}`;
  const testUserB = `test-user-b-${randomUUID().slice(0, 8)}`;

  // Ensure test users exist in User table
  await prisma.user.createMany({
    data: [
      { id: testUserA, email: `${testUserA}@miva.edu.ng`, username: testUserA, name: "Student A" },
      { id: testUserB, email: `${testUserB}@miva.edu.ng`, username: testUserB, name: "Student B" },
    ],
    skipDuplicates: true,
  });

  try {
    // -----------------------------------------------------------------------
    // Test 1: Another user's resource ID
    // -----------------------------------------------------------------------
    console.log("\n--- Test Case 1: Cross-User Authorization ---");
    const fakeStorageObj1 = randomUUID();
    const userAResource = await prisma.studentResource.create({
      data: {
        userId: testUserA,
        storageObjectId: fakeStorageObj1,
        title: "User A Resource",
        level: "100",
        department: "Computer Science",
        courseCode: "CSC101",
        courseTitle: "Intro to CS",
        resourceType: StudentResourceType.NOTE,
        fileFormat: FileFormat.PDF,
        status: StudentResourceStatus.DRAFT,
      },
    });

    let unauthorizedFailed = false;
    try {
      // User B attempts to submit User A's resource
      await StudentResourceService.submitResource(testUserB, userAResource.id);
    } catch (err: any) {
      unauthorizedFailed = err.message.includes("Resource not found or unauthorized");
    }
    assert(unauthorizedFailed, "User B cannot submit User A's resource (unauthorized rejection)");

    // -----------------------------------------------------------------------
    // Test 2: Valid upload & submission (DRAFT -> PENDING_REVIEW)
    // -----------------------------------------------------------------------
    console.log("\n--- Test Case 2: Valid DRAFT -> PENDING_REVIEW Submission ---");
    const submittedResource = await StudentResourceService.submitResource(testUserA, userAResource.id);
    assert(
      submittedResource.status === StudentResourceStatus.PENDING_REVIEW,
      "Resource successfully transitioned from DRAFT to PENDING_REVIEW"
    );
    assert(submittedResource.submittedAt !== null, "Resource recorded submittedAt timestamp");

    // -----------------------------------------------------------------------
    // Test 3: Rejected-resource resubmission
    // -----------------------------------------------------------------------
    console.log("\n--- Test Case 3: Rejected-Resource Resubmission Blocked ---");
    const fakeStorageObj2 = randomUUID();
    const rejectedResource = await prisma.studentResource.create({
      data: {
        userId: testUserA,
        storageObjectId: fakeStorageObj2,
        title: "Rejected Resource",
        level: "100",
        department: "Computer Science",
        courseCode: "CSC101",
        courseTitle: "Intro to CS",
        resourceType: StudentResourceType.PAST_QUESTION,
        fileFormat: FileFormat.PDF,
        status: StudentResourceStatus.REJECTED,
      },
    });

    let rejectedResubmitFailed = false;
    try {
      await StudentResourceService.submitResource(testUserA, rejectedResource.id);
    } catch (err: any) {
      rejectedResubmitFailed = err.message.includes("Only DRAFT resources can be submitted");
    }
    assert(rejectedResubmitFailed, "REJECTED resource cannot be submitted (transition blocked)");

    // -----------------------------------------------------------------------
    // Test 4: Seventh same-day submission (Rate Limit: 6 max per Lagos day)
    // -----------------------------------------------------------------------
    console.log("\n--- Test Case 4: 6-Submission Rate Limit & 7th Rejection ---");
    // Currently User A has 1 submission today (`userAResource`).
    // Create and submit 5 more resources (to reach 6 total submissions for today).
    for (let i = 2; i <= 6; i++) {
      const res = await prisma.studentResource.create({
        data: {
          userId: testUserA,
          storageObjectId: randomUUID(),
          title: `Resource #${i}`,
          level: "100",
          department: "Computer Science",
          courseCode: "CSC101",
          courseTitle: "Intro to CS",
          resourceType: StudentResourceType.NOTE,
          fileFormat: FileFormat.PDF,
          status: StudentResourceStatus.DRAFT,
        },
      });
      await StudentResourceService.submitResource(testUserA, res.id);
    }
    console.log("Successfully submitted 6 resources for User A today.");

    // Create 7th resource and attempt submission
    const seventhResource = await prisma.studentResource.create({
      data: {
        userId: testUserA,
        storageObjectId: randomUUID(),
        title: "Resource #7",
        level: "100",
        department: "Computer Science",
        courseCode: "CSC101",
        courseTitle: "Intro to CS",
        resourceType: StudentResourceType.NOTE,
        fileFormat: FileFormat.PDF,
        status: StudentResourceStatus.DRAFT,
      },
    });

    let seventhSubmissionFailed = false;
    try {
      await StudentResourceService.submitResource(testUserA, seventhResource.id);
    } catch (err: any) {
      seventhSubmissionFailed = err.message.includes("Daily submission limit reached");
    }
    assert(seventhSubmissionFailed, "7th same-day submission rejected by 6-per-day rate limit");

    console.log("\n🎉 All Gate 6 Integration Test Scenarios Passed Successfully!\n");
  } finally {
    // Cleanup test artifacts
    await prisma.studentResource.deleteMany({
      where: { userId: { in: [testUserA, testUserB] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [testUserA, testUserB] } },
    });
    await prisma.$disconnect();
  }
}

runE2ETests().catch((err) => {
  console.error("E2E Test execution failed:", err);
  process.exit(1);
});
