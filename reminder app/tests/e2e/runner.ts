/**
 * Remy Reminders — Master E2E Test Suite Runner
 * Executes Tier 1, Tier 2, Tier 3, and Tier 4 suites.
 *
 * Usage:
 *   node --no-warnings --experimental-strip-types tests/e2e/runner.ts
 */

import { runAllSuites, clearRegisteredSuites } from './harness/testFramework.ts';
import { registerTier1Tests } from './tier1_feature_coverage.test.ts';
import { registerTier2Tests } from './tier2_boundary_corner.test.ts';
import { registerTier3Tests } from './tier3_cross_feature.test.ts';
import { registerTier4Tests } from './tier4_workload_scenarios.test.ts';

async function main() {
  const startWallTime = Date.now();
  console.log('\n======================================================================');
  console.log('  REMY REMINDERS — E2E TEST RUNNER (4-TIER METHODOLOGY)');
  console.log('======================================================================');
  console.log(`Timestamp : ${new Date().toISOString()}`);
  console.log(`Runtime   : Node.js ${process.version} (${process.platform})`);
  console.log('----------------------------------------------------------------------\n');

  clearRegisteredSuites();

  // Register all 4 tiers
  registerTier1Tests();
  registerTier2Tests();
  registerTier3Tests();
  registerTier4Tests();

  const summary = await runAllSuites();

  // Group results by suite
  const suiteGroups = new Map<string, typeof summary.results>();
  for (const r of summary.results) {
    const list = suiteGroups.get(r.suite) || [];
    list.push(r);
    suiteGroups.set(r.suite, list);
  }

  console.log('RUNNING TEST SUITES:\n');
  for (const [suiteName, tests] of suiteGroups.entries()) {
    const suitePassed = tests.every((t) => t.passed);
    const badge = suitePassed ? 'PASS' : 'FAIL';
    console.log(`[${badge}] ${suiteName} (${tests.length} tests)`);

    for (const t of tests) {
      if (t.passed) {
        console.log(`  ✓ ${t.name} (${t.durationMs}ms)`);
      } else {
        console.log(`  ✗ ${t.name} (${t.durationMs}ms)`);
        if (t.error) {
          console.log(`    Error: ${t.error.message || t.error}`);
          if (t.error.stack) {
            const stackLines = t.error.stack.split('\n').slice(1, 4).map((l) => `      ${l.trim()}`).join('\n');
            console.log(stackLines);
          }
        }
      }
    }
    console.log('');
  }

  const passRate = summary.total > 0 ? ((summary.passed / summary.total) * 100).toFixed(1) : '0';
  const totalWallTimeMs = Date.now() - startWallTime;

  console.log('======================================================================');
  console.log('  E2E TEST EXECUTION SUMMARY');
  console.log('======================================================================');
  console.log(`Total Suites Run : ${suiteGroups.size}`);
  console.log(`Total Test Cases : ${summary.total}`);
  console.log(`Passed           : ${summary.passed}`);
  console.log(`Failed           : ${summary.failed}`);
  console.log(`Pass Rate        : ${passRate}%`);
  console.log(`Execution Time   : ${totalWallTimeMs}ms`);
  console.log('======================================================================\n');

  if (summary.failed > 0) {
    console.error(`🚨 E2E TEST RUN COMPLETED WITH ${summary.failed} FAILURE(S)`);
    process.exit(1);
  } else {
    console.log('🎉 ALL 4-TIER E2E TEST SUITES PASSED (100% SUCCESS)');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal error running E2E suites:', err);
  process.exit(1);
});
