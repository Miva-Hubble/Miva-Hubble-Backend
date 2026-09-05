// scripts/test-student-resources-gate6.ts

import "dotenv/config";
import { getLagosDayBounds } from "../src/services/studentResourceService.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ Assertion Failed: ${message}`);
    process.exitCode = 1;
    throw new Error(message);
  }
  console.log(`✅ Passed: ${message}`);
}

async function runTests() {
  console.log("🧪 Starting Gate 6 Verification Test Suite...\n");

  // -------------------------------------------------------------------------
  // Test 1: Lagos Midnight & Boundary Calculation
  // -------------------------------------------------------------------------
  console.log("--- Test Case 1: Lagos Midnight & Day Boundary Calculations ---");
  
  // Example: 2026-09-02 23:30:00 UTC is 2026-09-03 00:30:00 in Lagos (UTC+1)
  const datePastUtcMidnightInLagos = new Date("2026-09-02T23:30:00.000Z");
  const bounds1 = getLagosDayBounds(datePastUtcMidnightInLagos);
  
  assert(
    bounds1.start.toISOString() === "2026-09-02T23:00:00.000Z", // 2026-09-03 00:00:00+01:00
    "Lagos day start for 23:30 UTC is 23:00 UTC (Lagos midnight 00:00:00+01:00)"
  );
  assert(
    bounds1.end.toISOString() === "2026-09-03T22:59:59.999Z", // 2026-09-03 23:59:59.999+01:00
    "Lagos day end is 22:59:59.999 UTC (Lagos 23:59:59.999+01:00)"
  );

  // Exact Lagos Midnight: 2026-09-03 00:00:00+01:00 = 2026-09-02 23:00:00.000Z
  const exactLagosMidnight = new Date("2026-09-02T23:00:00.000Z");
  const boundsMidnight = getLagosDayBounds(exactLagosMidnight);
  assert(
    boundsMidnight.start.getTime() === exactLagosMidnight.getTime(),
    "Exact Lagos midnight timestamp matches day start boundary"
  );

  // 1ms before Lagos Midnight: 2026-09-02 22:59:59.999Z = 2026-09-02 23:59:59.999+01:00
  const justBeforeLagosMidnight = new Date("2026-09-02T22:59:59.999Z");
  const boundsBefore = getLagosDayBounds(justBeforeLagosMidnight);
  assert(
    boundsBefore.start.toISOString() === "2026-09-01T23:00:00.000Z",
    "1ms before midnight belongs to previous Lagos calendar day"
  );
  assert(
    boundsBefore.end.toISOString() === "2026-09-02T22:59:59.999Z",
    "End boundary for previous day aligns with exact previous moment"
  );

  console.log("\n✨ Gate 6 Unit & Boundary Tests Finished Successfully!\n");
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
