#!/usr/bin/env node

/**
 * Verify that test coverage meets the configured minimum thresholds across all metrics.
 * Reads coverage-final.json and validates statements, branches, functions, and lines
 * against the requiredCoverage configuration. Exits with code 1 if any metric is below
 * its minimum threshold, or 0 if all pass.
 */

const fs = require('fs');
const path = require('path');

const coveragePath = path.join(process.cwd(), 'coverage', 'coverage-final.json');

if (!fs.existsSync(coveragePath)) {
  console.error('❌ Coverage report not found. Run tests with --coverage flag first.');
  process.exit(1);
}

const coverage = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));

// Calculate totals across all files
const totals = {
  statements: { covered: 0, total: 0 },
  branches: { covered: 0, total: 0 },
  functions: { covered: 0, total: 0 },
  lines: { covered: 0, total: 0 }
};

for (const filePath in coverage) {
  const fileCoverage = coverage[filePath];
  
  // Statements
  if (fileCoverage.s) {
    for (const key in fileCoverage.s) {
      totals.statements.total++;
      if (fileCoverage.s[key] > 0) totals.statements.covered++;
    }
  }
  
  // Branches
  if (fileCoverage.b) {
    for (const key in fileCoverage.b) {
      const branches = fileCoverage.b[key];
      for (let i = 0; i < branches.length; i++) {
        totals.branches.total++;
        if (branches[i] > 0) totals.branches.covered++;
      }
    }
  }
  
  // Functions
  if (fileCoverage.f) {
    for (const key in fileCoverage.f) {
      totals.functions.total++;
      if (fileCoverage.f[key] > 0) totals.functions.covered++;
    }
  }
  
  // Lines
  if (fileCoverage.l) {
    for (const line in fileCoverage.l) {
      totals.lines.total++;
      if (fileCoverage.l[line] > 0) totals.lines.covered++;
    }
  }
}

const metrics = ['statements', 'branches', 'functions', 'lines'];
const requiredCoverage = {
  statements: 95,
  branches: 85,
  functions: 95,
  lines: 100
};

let allPassed = true;

console.log('\n📊 Coverage Report:\n');

for (const metric of metrics) {
  const { covered, total } = totals[metric];
  const pct = total > 0 ? ((covered / total) * 100).toFixed(2) : 100;
  const required = requiredCoverage[metric];
  const status = pct >= required ? '✅' : '❌';
  console.log(`${status} ${metric.padEnd(15)}: ${pct}% (${covered}/${total}) [required: ${required}%]`);
  if (pct < required) {
    allPassed = false;
  }
}

console.log('');

if (!allPassed) {
  console.error('❌ Coverage check failed: not all metrics meet minimum requirements.');
  process.exit(1);
}

console.log('✅ All coverage metrics meet requirements.\n');
process.exit(0);
