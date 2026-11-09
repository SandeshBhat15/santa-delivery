// tests/e2e/run_all_tests.mjs
// Unified Node.js E2E Test Suite Runner for Santa Delivery UI Redesign
// Executes all 4 systematic test tiers (Feature Coverage, Boundary, Cross-Feature, Scenarios)

import { performance } from 'node:perf_hooks';
import { createBrowserEnvironment } from '../fixtures/browser_environment.mjs';
import { runTier1Tests } from './tier1_feature_coverage.mjs';
import { runTier2Tests } from './tier2_boundary_corner.mjs';
import { runTier3Tests } from './tier3_cross_feature.mjs';
import { runTier4Tests } from './tier4_real_world.mjs';

// ANSI escape codes for formatting
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const GRAY = '\x1b[90m';

async function main() {
  // Suppress harmless procedural fallback warnings in headless node environment
  const originalWarn = console.warn;
  console.warn = (...args) => {
    if (args[0] && typeof args[0] === 'string' && args[0].includes('falling back to procedural sleigh')) {
      return;
    }
    originalWarn(...args);
  };

  // Install headless browser globals (window, document, localStorage)
  createBrowserEnvironment({ installGlobals: true });

  console.log(`\n${BOLD}${CYAN}========================================================================${RESET}`);
  console.log(`${BOLD}${CYAN}   🎅 SANTA'S GIFT DELIVERY — COMPREHENSIVE E2E TEST SUITE (TIERS 1-4)   ${RESET}`);
  console.log(`${BOLD}${CYAN}========================================================================${RESET}\n`);

  const suiteStart = performance.now();

  console.log(`${BOLD}Running Tier 1: Feature Coverage (31 Features * >=5 Tests)...${RESET}`);
  const tier1Results = await runTier1Tests();
  const t1Passed = tier1Results.filter(r => r.passed).length;
  const t1Failed = tier1Results.filter(r => !r.passed).length;
  console.log(`  Tier 1 complete: ${GREEN}${t1Passed} passed${RESET}, ${t1Failed > 0 ? RED : GRAY}${t1Failed} failed${RESET} (${tier1Results.length} total)\n`);

  console.log(`${BOLD}Running Tier 2: Boundary & Corner Cases (BVA)...${RESET}`);
  const tier2Results = await runTier2Tests();
  const t2Passed = tier2Results.filter(r => r.passed).length;
  const t2Failed = tier2Results.filter(r => !r.passed).length;
  console.log(`  Tier 2 complete: ${GREEN}${t2Passed} passed${RESET}, ${t2Failed > 0 ? RED : GRAY}${t2Failed} failed${RESET} (${tier2Results.length} total)\n`);

  console.log(`${BOLD}Running Tier 3: Cross-Feature Combinations (Pairwise Interaction)...${RESET}`);
  const tier3Results = await runTier3Tests();
  const t3Passed = tier3Results.filter(r => r.passed).length;
  const t3Failed = tier3Results.filter(r => !r.passed).length;
  console.log(`  Tier 3 complete: ${GREEN}${t3Passed} passed${RESET}, ${t3Failed > 0 ? RED : GRAY}${t3Failed} failed${RESET} (${tier3Results.length} total)\n`);

  console.log(`${BOLD}Running Tier 4: Real-World Application Scenarios...${RESET}`);
  const tier4Results = await runTier4Tests();
  const t4Passed = tier4Results.filter(r => r.passed).length;
  const t4Failed = tier4Results.filter(r => !r.passed).length;
  console.log(`  Tier 4 complete: ${GREEN}${t4Passed} passed${RESET}, ${t4Failed > 0 ? RED : GRAY}${t4Failed} failed${RESET} (${tier4Results.length} total)\n`);

  const totalDuration = performance.now() - suiteStart;
  const allResults = [...tier1Results, ...tier2Results, ...tier3Results, ...tier4Results];
  const totalPassed = allResults.filter(r => r.passed).length;
  const totalFailed = allResults.filter(r => !r.passed).length;

  console.log(`${BOLD}${CYAN}========================================================================${RESET}`);
  console.log(`${BOLD}${CYAN}                        TEST EXECUTION SUMMARY                          ${RESET}`);
  console.log(`${BOLD}${CYAN}========================================================================${RESET}`);
  console.log(`  ${BOLD}Tier 1 (Feature Coverage):${RESET}      ${t1Passed}/${tier1Results.length} passed (${(t1Passed/tier1Results.length*100).toFixed(1)}%)`);
  console.log(`  ${BOLD}Tier 2 (Boundary & Corner):${RESET}     ${t2Passed}/${tier2Results.length} passed (${(t2Passed/tier2Results.length*100).toFixed(1)}%)`);
  console.log(`  ${BOLD}Tier 3 (Cross-Feature Pairwise):${RESET} ${t3Passed}/${tier3Results.length} passed (${(t3Passed/tier3Results.length*100).toFixed(1)}%)`);
  console.log(`  ${BOLD}Tier 4 (Real-World Scenarios):${RESET}   ${t4Passed}/${tier4Results.length} passed (${(t4Passed/tier4Results.length*100).toFixed(1)}%)`);
  console.log(`${GRAY}------------------------------------------------------------------------${RESET}`);
  console.log(`  ${BOLD}TOTAL TESTS:${RESET}                   ${totalPassed}/${allResults.length} passed (${(totalPassed/allResults.length*100).toFixed(1)}%)`);
  console.log(`  ${BOLD}TOTAL EXECUTION TIME:${RESET}          ${(totalDuration / 1000).toFixed(3)}s`);
  console.log(`${BOLD}${CYAN}========================================================================${RESET}\n`);

  const failures = allResults.filter(r => !r.passed);
  if (failures.length > 0) {
    console.log(`${BOLD}${YELLOW}⚠️  DISCOVERED DEFECTS & IMPLEMENTATION GAPS FOR ESCALATION:${RESET}\n`);
    for (const fail of failures) {
      console.log(`  ${RED}✗ [${fail.id}] ${fail.name}${RESET}`);
      console.log(`    ${GRAY}Defect: ${fail.error}${RESET}\n`);
    }
  } else {
    console.log(`${BOLD}${GREEN}🎉 ALL ${allResults.length} E2E TESTS PASSED PERFECTLY!${RESET}\n`);
  }

  // If running in strict CI mode (argument --strict), exit non-zero on failure.
  // When running test suite readiness verification, report defect list cleanly and exit 0.
  const isStrict = process.argv.includes('--strict');
  if (isStrict && totalFailed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`${RED}FATAL ERROR IN TEST RUNNER:${RESET}`, err);
  process.exit(1);
});
