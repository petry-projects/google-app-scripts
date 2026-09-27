#!/usr/bin/env node

/**
 * Strict No-PII Scanner for petry-projects/google-app-scripts
 * Ensures that open-source code, docs, and tests remain completely generic
 * and free of personal household identities, addresses, and private businesses.
 *
 * Usage:
 *   node scripts/check-no-pii.js           # Scans src/, scripts/, deploy/, and root docs
 *   node scripts/check-no-pii.js --staged  # Scans only git-staged files
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

// Prohibited PII patterns with human-readable descriptions
const PROHIBITED_RULES = [
  {
    name: 'Specific Student / Family Names',
    pattern:
      /\b(Charley[- ]Ann|Toby[- ]Bowen|Tide[- ]Bowen|David[- ]Jonathan|Rachel[- ]Bowen|Rachel[- ]Petry|DJ & Rachel|DJ-Rachel)\b/i,
    description:
      'Personal family member names must not be hardcoded in open-source repos.',
  },
  {
    name: 'Extended Family Names',
    pattern: /\b(Naomi|Babbi|Kattrien|Buchkowski)\b/i,
    description: 'Personal extended family names must not be hardcoded.',
  },
  {
    name: 'Household Surnames',
    pattern: /\b(Petry)\b/i,
    description:
      'Household surname found outside of allowed open-source organizational context.',
    whitelist: [
      /petry-projects/i,
      /github\.com\/don-petry/i,
      /github\.com\/petry-projects/i,
      /don-petry/i,
      /Copyright \(c\) \d{4} Don Petry/i,
      /Don Petry \u2013/i,
      /Petry-Projects \u2013/i,
    ],
  },
  {
    name: 'Personal Properties & Street Addresses',
    pattern: /\b(Five Oaks|2809 Five Oaks)\b/i,
    description:
      'Personal street addresses and property names must not be committed.',
  },
  {
    name: 'Private Household Businesses',
    pattern: /\b(Honey[- ]BeeHam|honey4beeham)\b/i,
    description: 'Private family business identities must not be committed.',
  },
  {
    name: 'Personal School Affiliations',
    pattern: /\b(Briarwood Christian|Magic City Acceptance Academy)\b/i,
    description:
      'Specific local school affiliations must not be committed to open-source.',
  },
  {
    name: 'Personal Gmail Addresses',
    pattern: /\b[a-zA-Z0-9._%+-]+@gmail\.com\b/i,
    description:
      'Personal Gmail addresses must not be in open-source files; use generic placeholders (e.g. user@example.com).',
    whitelist: [
      /user@example\.com/i,
      /user1@example\.com/i,
      /user2@example\.com/i,
      /household-member@gmail\.com/i,
      /your-email@gmail\.com/i,
      /primary@gmail\.com/i,
      /testuser@gmail\.com/i,
    ],
  },
]

// Extensions and directories to scan
const SCANNABLE_EXTENSIONS = new Set([
  '.js',
  '.ts',
  '.gs',
  '.json',
  '.md',
  '.yml',
  '.yaml',
  '.html',
])

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'coverage',
  'dist',
  'build',
  '.wt-',
])

function isIgnoredPath(relPath) {
  const parts = relPath.split(path.sep)
  for (const part of parts) {
    if (IGNORED_DIRS.has(part) || part.startsWith('.wt-')) {
      return true
    }
  }
  // Exclude this script itself from scanning its own pattern definitions
  if (relPath === 'scripts/check-no-pii.js') {
    return true
  }
  return false
}

function getStagedFiles() {
  try {
    const output = execSync('git diff --cached --name-only --diff-filter=ACM', {
      encoding: 'utf8',
    })
    return output
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean)
  } catch (err) {
    console.error('Error fetching staged files from git:', err.message)
    process.exit(1)
  }
}

function getAllRepoFiles(dir = process.cwd(), base = '') {
  let results = []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const relPath = path.join(base, entry.name)
    if (isIgnoredPath(relPath)) continue

    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results = results.concat(getAllRepoFiles(fullPath, relPath))
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase()
      if (SCANNABLE_EXTENSIONS.has(ext)) {
        results.push(relPath)
      }
    }
  }
  return results
}

function scanFile(filePath) {
  if (!fs.existsSync(filePath)) return []

  const content = fs.readFileSync(filePath, 'utf8')
  const lines = content.split('\n')
  const violations = []

  lines.forEach((line, index) => {
    // Support inline ignore: // pii-ignore or <!-- pii-ignore -->
    if (line.includes('pii-ignore')) return

    for (const rule of PROHIBITED_RULES) {
      if (rule.pattern.test(line)) {
        // Check whitelist
        if (rule.whitelist) {
          const isWhitelisted = rule.whitelist.some((wl) => wl.test(line))
          if (isWhitelisted) continue
        }

        const match = line.match(rule.pattern)
        violations.push({
          file: filePath,
          line: index + 1,
          rule: rule.name,
          match: match ? match[0] : '',
          description: rule.description,
          content: line.trim(),
        })
      }
    }
  })

  return violations
}

function main() {
  const isStagedOnly = process.argv.includes('--staged')
  const filesToScan = isStagedOnly
    ? getStagedFiles().filter((f) => {
        const ext = path.extname(f).toLowerCase()
        return SCANNABLE_EXTENSIONS.has(ext) && !isIgnoredPath(f)
      })
    : getAllRepoFiles()

  if (filesToScan.length === 0) {
    console.log('✅ No scannable files found. PII check passed.')
    process.exit(0)
  }

  let totalViolations = []
  for (const file of filesToScan) {
    const violations = scanFile(file)
    if (violations.length > 0) {
      totalViolations = totalViolations.concat(violations)
    }
  }

  if (totalViolations.length > 0) {
    console.error(
      '\n❌ PII CHECK FAILED — Prohibited Personal Information Detected:'
    )
    console.error(
      '─────────────────────────────────────────────────────────────────'
    )
    for (const v of totalViolations) {
      console.error(
        `• [${v.rule}] ${v.file}:${v.line}\n  Matched: "${v.match}"\n  Line: "${v.content}"\n  Remedy: ${v.description}\n`
      )
    }
    console.error(
      '─────────────────────────────────────────────────────────────────'
    )
    console.error(
      'The petry-projects/google-app-scripts repository is a generic open-source'
    )
    console.error(
      'harness. Personal student names, private businesses, and household addresses'
    )
    console.error(
      'must be injected via ScriptProperties (CUSTOM_PROMPT_RULES), never committed.'
    )
    console.error(
      '─────────────────────────────────────────────────────────────────\n'
    )
    process.exit(1)
  }

  console.log(
    `✅ Strict No-PII check passed (${filesToScan.length} file(s) scanned).`
  )
  process.exit(0)
}

main()
