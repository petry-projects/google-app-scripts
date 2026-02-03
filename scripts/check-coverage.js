#!/usr/bin/env node

/**
 * Verify that test coverage meets 100% across all metrics.
 * Reads coverage-final.json and validates statements, branches, functions, and lines.
 * Exit code 1 if any metric is below 100%, 0 if all pass.
 */

const fs = require('fs');
const path = require('path');

const coveragePath = path.join(process.cwd(), 'coverage', 'coverage-final.json');

if (!fs.existsSync(coveragePath)) {
  console.error('❌ Coverage report not found. Run tests with --coverage flag first.');
  process.exit(1);
}

const coverage = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
const metrics = ['statements', 'branches', 'functions', 'lines'];
let allPassed = true;

console.log('\n📊 Coverage Report:\n');

for (const metric of metrics) {
  const pct = coverage.total[metric]?.pct ?? 0;
  const status = pct === 100 ? '✅' : '❌';
  console.log(`${status} ${metric.padEnd(15)}: ${pct.toFixed(2)}%`);
  if (pct !== 100) {
    allPassed = false;
  }
}

console.log('');

if (!allPassed) {
  console.error('❌ Coverage check failed: not all metrics are at 100%.');
  process.exit(1);
}

console.log('✅ All coverage metrics are at 100%.\n');
process.exit(0);
