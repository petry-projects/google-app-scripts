# Development Guide

**Generated:** 2026-03-28 | **Scan Level:** Exhaustive

## Prerequisites

- **Node.js** 20+ (for testing, linting, type checking)
- **npm** (comes with Node.js)
- **Git** (with hooks support)

No Google Apps Script CLI (`clasp`) is required. Scripts are deployed via the browser-based UI.

## Installation

```bash
cd google-app-scripts
npm install
```

This also runs `husky` via the `prepare` script, setting up Git hooks.

## Environment Setup

No `.env` file is required for development. All configuration is in `config.gs` files (production) or mocked in tests (development).

## Available Commands

| Command                          | Description                                             |
| -------------------------------- | ------------------------------------------------------- |
| `npm test`                       | Run all Jest unit tests (serial via `--runInBand`)      |
| `npm run test:e2e`               | Run Playwright E2E tests (deploy UI + gas-installer UI) |
| `npm run lint`                   | ESLint check on `src/`                                  |
| `npm run format`                 | Prettier auto-format all files                          |
| `npm run check`                  | Prettier check + lint (CI validation)                   |
| `npm run typecheck`              | TypeScript type check (`noEmit`)                        |
| `npx jest "<folder>/tests"`      | Run tests for a specific script                         |
| `npx jest --coverage`            | Run tests with coverage report                          |
| `node scripts/check-coverage.js` | Validate coverage meets thresholds                      |

## Development Workflow

### Adding a New Script

1. Create folder: `src/<script-name>/`
2. Create `code.gs` — GAS entry point with trigger functions
3. Create `config.gs` — Configuration template
4. Create `src/index.js` — Extract testable logic, accept GAS services as parameters
5. Create `tests/` — Jest tests importing from `src/index.js`
6. Create `README.md` — Script documentation
7. Add script to catalog in `src/deploy/index.js` (`getScriptCatalog()`)
8. Add configuration form to `deploy/index.html`

### Modifying Existing Scripts

1. **Read the script's `README.md`** for context
2. **Write tests first** (TDD) — modify `tests/*.test.js`
3. **Update `src/index.js`** — implement the change in testable code
4. **Update `code.gs`** — mirror changes in the GAS-native wrapper
5. **Run tests:** `npx jest "src/<script-name>/tests"`
6. **Check coverage:** `npx jest --coverage`
7. **Format:** `npx prettier --write .`
8. **Lint:** `npm run lint`
9. **Type check:** `npm run typecheck`

### Testing GAS Code

GAS `.gs` files cannot be imported in Node.js. The project uses a dual-file pattern:

```text
code.gs (GAS runtime)          src/index.js (Node.js testable)
┌─────────────────────┐        ┌──────────────────────────┐
│ function main() {   │        │ function main(deps) {    │
│   const doc =       │        │   const doc =            │
│     DocumentApp     │        │     deps.DocumentApp     │
│     .openById(id)   │        │     .openById(id)        │
│   // ... logic      │        │   // ... same logic      │
│ }                   │        │ }                        │
└─────────────────────┘        │ module.exports = {main}  │
                               └──────────────────────────┘
```

**In tests:**

```javascript
// test-utils/setup.js installs global mocks automatically
const { main } = require('../src/index.js')

test('processes messages', () => {
  // Mocks are already installed globally
  // Test pure logic without GAS runtime
})
```

### Running Playwright E2E Tests

```bash
# Install browsers (first time only)
npx playwright install --with-deps chromium

# Run E2E tests
npm run test:e2e
```

E2E tests mock all external APIs via `page.route()` and `page.addInitScript()`. No Google account or API keys needed.

## Code Style

- **Prettier:** Single quotes, no semicolons, trailing commas (ES5), 80 char width
- **ESLint:** typescript-eslint + prettier plugin
- **Commits:** Conventional commits enforced by commitlint (`feat:`, `fix:`, `chore:`, etc.)
- **Pre-commit hooks:** lint-staged (format + lint) + typecheck

**Always run before committing:**

```bash
npx prettier --write .
npm run check
npm test -- --coverage
```

## Coverage Requirements

| Metric     | Threshold                                        |
| ---------- | ------------------------------------------------ |
| Lines      | 99% (Jest config) / 100% (CI check-coverage.js)  |
| Statements | 95%                                              |
| Functions  | 95%                                              |
| Branches   | 85%                                              |

Coverage is enforced by:

1. Jest config `coverageThreshold` in `jest.config.js`
2. `scripts/check-coverage.js` in CI
3. GitHub Actions `coverage.yml` workflow

**Rules:**

- No `istanbul ignore` / `c8 ignore` pragmas unless truly unavoidable
- No `.skip()` on failing tests — fix them
- No mock-based coverage inflation

## Git Hooks

| Hook         | Action                                                               |
| ------------ | -------------------------------------------------------------------- |
| `pre-commit` | `npx lint-staged` (format + lint staged files) + `npm run typecheck` |
| `commit-msg` | `commitlint --edit` (enforce conventional commits)                   |

## CI/CD Pipelines

| Workflow                   | Trigger           | Actions                                                  |
| -------------------------- | ----------------- | -------------------------------------------------------- |
| `ci.yml`                   | Push to main, PRs | Lint, format check, typecheck, auto-fix on same-repo PRs |
| `nodejs-tests.yml`         | Push to main, PRs | Jest unit tests for all packages                         |
| `playwright-tests.yml`     | Push to main, PRs | Playwright E2E tests                                     |
| `coverage.yml`             | Push to main, PRs | Coverage enforcement (100% lines)                        |
| `codeql-analysis.yml`      | Push to main, PRs | CodeQL security scanning                                 |
| `dependabot-automerge.yml` | Dependabot PRs    | Auto-merge minor/patch updates                           |

## Repository Conventions

- Thread separators use 30 `=` signs (`==============================`)
- Thread deduplication embeds Gmail thread ID: `------------------------------[THREAD:threadId]`
- Prepend ordering: process oldest-first so newest appears at document top
- `getCleanBody()` collapses 2+ consecutive newlines to a single newline
- Always sort Gmail threads by last-message date before processing
- Configuration uses arrays for multi-config support
- File type convention: `.gs` for GAS runtime, `.js` for testable Node.js logic
