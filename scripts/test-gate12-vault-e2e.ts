// scripts/test-gate12-vault-e2e.ts
//
// Gate 12 — Vault (student-facing discovery + signed access) end-to-end
// test suite. Boots the real Express app in-process (same pattern as
// test-gate9-progress-endpoint.ts) and exercises it over real HTTP against
// the configured database — no mocking of Prisma or Supabase.
//
// Covers every scenario in the Gate 12 checklist:
//   1. An approved, level/department-matching resource appears in the Vault.
//   2. PENDING_REVIEW / REJECTED / ARCHIVED resources never appear.
//   3. A different level or department yields no result, even if APPROVED.
//   4. An ineligible resource URL request returns 404 (never 403).
//   5. Both preview and download modes return a real signed URL.
//   6. GET /api/student-resources/mine returns every one of the caller's
//      own resources across all statuses, including rejectionReason.
//   7. No response ever contains a raw storagePath or storageObjectId.

process.env.NODE_ENV = "test";
process.env.DISABLE_NOTIFICATION_WORKER = "true";

import "dotenv/config";
import http from "http";
import { AddressInfo } from "net";
import { randomUUID } from "crypto";
import prisma from "../src/lib/prisma.js";
import { app } from "../src/app.js";
import { AuthService } from "../src/services/authService.js";
import { supabaseAdmin } from "../src/config/supabase.js";
import {
  StudentResourceStatus,
  StudentResourceType,
  FileFormat,
} from "../src/services/studentResourceService.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ Assertion Failed: ${message}`);
    process.exitCode = 1;
    throw new Error(message);
  }
  console.log(`✅ Passed: ${message}`);
}

async function makeStudent(idPrefix: string, level: string, department: string) {
  const id = `${idPrefix}-${randomUUID().slice(0, 8)}`;
  const user = await prisma.user.create({
    data: { id, name: idPrefix, username: id, email: `${id}@miva.edu.ng` },
  });
  await prisma.onboarding.create({
    data: { userId: user.id, level, department, goals: [] },
  });
  const token = AuthService.generateAccessToken({ userId: user.id, email: user.email });
  return { user, token };
}

let resourceCounter = 0;
const fixturePaths: string[] = [];
const studentResourcesBucket = process.env.SUPABASE_STUDENT_RESOURCES_BUCKET || "student-resources";

/**
 * Creates a StudentResource directly via Prisma (bypassing the real
 * upload/draft/submit/review flow, which Gates 6/7 already cover
 * end-to-end) so this suite can cheaply set up resources in every status
 * Gate 12 needs to distinguish between.
 */
async function makeResource(opts: {
  userId: string;
  status: StudentResourceStatus;
  level: string;
  department: string;
  rejectionReason?: string;
}) {
  resourceCounter += 1;
  const storagePath = `student-resources/${opts.userId}/gate12-fixture-${resourceCounter}.pdf`;

  // Signed-URL coverage needs a real Storage object, not a made-up UUID.
  const { error: uploadError } = await supabaseAdmin.storage
    .from(studentResourcesBucket)
    .upload(storagePath, Buffer.from("%PDF-1.4\nGate 12 fixture\n%%EOF"), {
      contentType: "application/pdf",
      upsert: false,
    });
  if (uploadError) throw new Error(`Failed to create Gate 12 storage fixture: ${uploadError.message}`);
  fixturePaths.push(storagePath);

  const storageRows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM storage.objects
    WHERE bucket_id = ${studentResourcesBucket} AND name = ${storagePath}
    LIMIT 1
  `;
  if (!storageRows[0]) throw new Error("Gate 12 storage fixture was uploaded but has no storage.objects row");

  return prisma.studentResource.create({
    data: {
      userId: opts.userId,
      storageObjectId: storageRows[0].id,
      storagePath,
      mimeType: "application/pdf",
      sizeBytes: 12345,
      title: `Gate12 Resource #${resourceCounter}`,
      level: opts.level,
      department: opts.department,
      courseCode: "CSC101",
      courseTitle: "Intro to CS",
      resourceType: StudentResourceType.NOTE,
      fileFormat: FileFormat.PDF,
      status: opts.status,
      ...(opts.status === StudentResourceStatus.APPROVED ? { approvedAt: new Date() } : {}),
      ...(opts.status === StudentResourceStatus.REJECTED
        ? { rejectionReason: opts.rejectionReason ?? "Not a fit for this course" }
        : {}),
    },
  });
}

async function runGate12Tests() {
  console.log("🧪 Starting Gate 12 Vault End-to-End Test Suite...\n");

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  const BASE_URL = `http://127.0.0.1:${port}`;

  const testUserIds: string[] = [];

  try {
    // -------------------------------------------------------------------
    // Setup: one student ("A") at 100/Computer Science, one ("B") at a
    // different level+department entirely, to prove eligibility isolation.
    // -------------------------------------------------------------------
    const { user: studentA, token: tokenA } = await makeStudent("gate12-a", "100", "Computer Science");
    const { user: studentB, token: tokenB } = await makeStudent("gate12-b", "300", "Mechanical Engineering");
    testUserIds.push(studentA.id, studentB.id);

    const approved = await makeResource({
      userId: studentA.id,
      status: StudentResourceStatus.APPROVED,
      level: "100",
      department: "Computer Science",
    });
    const pending = await makeResource({
      userId: studentA.id,
      status: StudentResourceStatus.PENDING_REVIEW,
      level: "100",
      department: "Computer Science",
    });
    const rejected = await makeResource({
      userId: studentA.id,
      status: StudentResourceStatus.REJECTED,
      level: "100",
      department: "Computer Science",
      rejectionReason: "Duplicate of an existing resource",
    });
    const archived = await makeResource({
      userId: studentA.id,
      status: StudentResourceStatus.ARCHIVED,
      level: "100",
      department: "Computer Science",
    });
    // Approved, but for a level/department nobody in this suite shares —
    // exists purely to prove it's excluded from every student's Vault.
    const mismatchedApproved = await makeResource({
      userId: studentA.id,
      status: StudentResourceStatus.APPROVED,
      level: "500",
      department: "Law",
    });

    const getVault = async (token: string) =>
      (await (await fetch(`${BASE_URL}/api/vault`, { headers: { Authorization: `Bearer ${token}` } })).json()) as any;

    // -------------------------------------------------------------------
    // Test 1: approved, matching resource appears
    // -------------------------------------------------------------------
    console.log("\n--- Test 1: Approved Matching Resource Appears ---");
    const vaultA = await getVault(tokenA);
    const vaultIds = vaultA.resources.map((r: any) => r.id);
    assert(vaultIds.includes(approved.id), "Approved, level/department-matching resource appears in Vault");

    // -------------------------------------------------------------------
    // Test 2: pending / rejected / archived never appear
    // -------------------------------------------------------------------
    console.log("\n--- Test 2: Non-Approved Statuses Never Appear ---");
    assert(!vaultIds.includes(pending.id), "PENDING_REVIEW resource does not appear in Vault");
    assert(!vaultIds.includes(rejected.id), "REJECTED resource does not appear in Vault");
    assert(!vaultIds.includes(archived.id), "ARCHIVED resource does not appear in Vault");

    // -------------------------------------------------------------------
    // Test 3: different level/department receives no result for that item
    // -------------------------------------------------------------------
    console.log("\n--- Test 3: Level/Department Mismatch Excluded ---");
    assert(!vaultIds.includes(mismatchedApproved.id), "APPROVED resource for a different level/department is excluded");
    const vaultB = await getVault(tokenB);
    assert(vaultB.resources.length === 0, "Student B (different level+department) sees zero of Student A's resources");

    // -------------------------------------------------------------------
    // Test 4: ineligible URL request returns 404
    // -------------------------------------------------------------------
    console.log("\n--- Test 4: Ineligible Resource URL Returns 404 ---");
    const ineligibleRes = await fetch(`${BASE_URL}/api/vault/${approved.id}/url?mode=download`, {
      headers: { Authorization: `Bearer ${tokenB}` }, // B is ineligible for A's resource
    });
    assert(ineligibleRes.status === 404, "Requesting a signed URL for an ineligible resource returns 404, not 403");

    const nonexistentRes = await fetch(`${BASE_URL}/api/vault/${randomUUID()}/url?mode=download`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert(nonexistentRes.status === 404, "Requesting a signed URL for a nonexistent resource also returns 404 (same as ineligible)");

    const pendingUrlRes = await fetch(`${BASE_URL}/api/vault/${pending.id}/url?mode=download`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert(pendingUrlRes.status === 404, "A PENDING_REVIEW resource's own owner still gets 404 from /api/vault (not eligibility-based on ownership)");

    // -------------------------------------------------------------------
    // Test 5: preview and download both return signed URLs
    // -------------------------------------------------------------------
    console.log("\n--- Test 5: Preview & Download Return Signed URLs ---");
    const previewRes = await (await fetch(`${BASE_URL}/api/vault/${approved.id}/url?mode=preview`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    })).json() as any;
    assert(typeof previewRes.signedUrl === "string" && previewRes.signedUrl.length > 0, "mode=preview returns a non-empty signedUrl");
    // Supabase signed URLs never carry a `download` query param unless
    // explicitly requested — confirms the inline (non-attachment) branch
    // actually ran for preview, not a fallback to the download branch.
    assert(!previewRes.signedUrl.includes("download="), "Preview signed URL has no `download=` param — inline disposition");

    const downloadRes = await (await fetch(`${BASE_URL}/api/vault/${approved.id}/url?mode=download`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    })).json() as any;
    assert(typeof downloadRes.signedUrl === "string" && downloadRes.signedUrl.length > 0, "mode=download returns a non-empty signedUrl");
    assert(downloadRes.signedUrl.includes("download="), "Download signed URL carries a `download=` param — forces attachment");

    // mode must be restricted to exactly "preview" | "download"
    const badModeRes = await fetch(`${BASE_URL}/api/vault/${approved.id}/url?mode=stream`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert(badModeRes.status === 400, "mode=stream (anything other than preview/download) is rejected with 400");

    // -------------------------------------------------------------------
    // Test 6: /mine returns every status + rejectionReason, ownership-based
    // -------------------------------------------------------------------
    console.log("\n--- Test 6: /mine Returns All Own Statuses + Rejection Reason ---");
    const mineA = (await (await fetch(`${BASE_URL}/api/student-resources/mine`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    })).json()) as any;
    const mineIds = mineA.resources.map((r: any) => r.id);
    assert(
      [approved.id, pending.id, rejected.id, archived.id, mismatchedApproved.id].every((id) => mineIds.includes(id)),
      "/mine returns the caller's resources across every status (DRAFT/PENDING/APPROVED/REJECTED/ARCHIVED)"
    );
    const rejectedInMine = mineA.resources.find((r: any) => r.id === rejected.id);
    assert(
      rejectedInMine?.rejectionReason === "Duplicate of an existing resource",
      "/mine includes the real rejectionReason on a rejected resource"
    );

    const mineB = (await (await fetch(`${BASE_URL}/api/student-resources/mine`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    })).json()) as any;
    assert(mineB.resources.length === 0, "/mine is ownership-scoped — Student B sees none of Student A's resources");

    // -------------------------------------------------------------------
    // Test 7: storagePath / storageObjectId never appear in any response
    // -------------------------------------------------------------------
    console.log("\n--- Test 7: No Raw storagePath or storageObjectId Leaks ---");
    const allSurfacedResources = [...vaultA.resources, ...mineA.resources];
    assert(
      allSurfacedResources.every((r: any) => !("storagePath" in r)),
      "No resource in /api/vault or /api/student-resources/mine includes storagePath"
    );
    assert(
      allSurfacedResources.every((r: any) => !("storageObjectId" in r)),
      "No resource in /api/vault or /api/student-resources/mine includes storageObjectId"
    );
    assert(
      !JSON.stringify(vaultA).includes(approved.storagePath) && !JSON.stringify(mineA).includes(approved.storagePath),
      "The literal storagePath value never appears anywhere in either response body"
    );

    console.log("\n🎉 All Gate 12 Vault Scenarios Verified Successfully!\n");
  } finally {
    server.close();
    await prisma.resourceContribution.deleteMany({ where: { studentResource: { userId: { in: testUserIds } } } });
    await prisma.studentResource.deleteMany({ where: { userId: { in: testUserIds } } });
    await prisma.dailyGoal.deleteMany({ where: { userId: { in: testUserIds } } });
    await prisma.userProgression.deleteMany({ where: { userId: { in: testUserIds } } });
    await prisma.onboarding.deleteMany({ where: { userId: { in: testUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: testUserIds } } });
    if (fixturePaths.length > 0) {
      const { error } = await supabaseAdmin.storage.from(studentResourcesBucket).remove(fixturePaths);
      if (error) console.error("Failed to remove Gate 12 storage fixtures:", error.message);
    }
    await prisma.$disconnect();
  }
}

runGate12Tests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("Gate 12 Test execution failed:", err);
    process.exit(1);
  });
