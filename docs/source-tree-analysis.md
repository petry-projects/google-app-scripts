# Source Tree Analysis

**Generated:** 2026-03-28 | **Scan Level:** Exhaustive

## Directory Tree

```
google-app-scripts/
├── deploy/                              # Browser-based deployment UI
│   ├── index.html                       # ★ Static SPA — OAuth, deploy, configure (2500+ lines)
│   └── tests/
│       └── ui.spec.js                   # Playwright E2E tests for deploy UI
│
├── gas-installer/                       # Legacy GAS-based web app installer
│   ├── appsscript.json                  # GAS project manifest (V8, webapp)
│   ├── Code.gs                          # Server-side GAS: fetch from GitHub, deploy via API
│   ├── Index.html                       # Installer web UI (382 lines)
│   ├── src/
│   │   └── index.js                     # Extracted testable logic (getFileType, filterGithubItems, etc.)
│   └── tests/
│       ├── index.test.js                # Jest unit tests
│       └── ui.spec.js                   # Playwright E2E tests
│
├── src/                                 # ★ Main source — all automation scripts
│   ├── gas-utils.js                     # Shared utilities (getCleanBody, getFileHash)
│   │
│   ├── gmail-to-drive-by-labels/        # Script: Archive Gmail → Google Doc + Drive folder
│   │   ├── code.gs                      # ★ GAS entry point (storeEmailsAndAttachments, rebuildAllDocs)
│   │   ├── config.gs                    # Configuration template (getProcessConfig → array)
│   │   ├── README.md                    # Script documentation
│   │   ├── src/
│   │   │   └── index.js                 # Testable logic (processMessagesToDoc, rebuildDoc, etc.)
│   │   └── tests/
│   │       ├── code.test.js             # Main function tests (649 lines)
│   │       ├── gas-utils.test.js         # Shared utility tests
│   │       ├── integration.test.js       # Full pipeline integration tests (521 lines)
│   │       ├── mocks.integration.test.js # Mock infrastructure validation
│   │       ├── prepend-behavior.test.js  # Document prepend ordering tests
│   │       ├── rebuild.test.js           # Document rebuild tests (439 lines)
│   │       ├── thread-deduplication.test.js  # Dedup logic tests (273 lines)
│   │       └── thread-ordering.test.js   # Thread sort order tests
│   │
│   ├── calendar-to-sheets/              # Script: Sync Google Calendar → Google Sheets
│   │   ├── code.gs                      # ★ GAS entry point (syncCalendarToSheetGAS, fullResync)
│   │   ├── config.gs                    # Configuration template (SYNC_CONFIGS array)
│   │   ├── README.md                    # Script documentation
│   │   ├── src/
│   │   │   └── index.js                 # Testable logic (syncCalendarToSheet, eventToRow, etc.)
│   │   └── tests/
│   │       └── index.test.js            # Unit tests (2278 lines)
│   │
│   ├── calendar-to-briefing-doc/        # Script: Weekly calendar briefing → email
│   │   ├── code.gs                      # ★ GAS entry point (generateWeeklyBriefing)
│   │   ├── config.gs                    # Configuration template (BRIEFING_CONFIGS array)
│   │   ├── README.md                    # Script documentation
│   │   ├── src/
│   │   │   └── index.js                 # Testable logic (fetchEvents, detectConflicts, formatBriefing, etc.)
│   │   └── tests/
│   │       └── index.test.js            # Unit tests (1487 lines)
│   │
│   └── deploy/                          # Deployment utility module
│       ├── index.js                     # Script catalog, GAS project creation, Gmail label API
│       └── tests/
│           └── index.test.js            # Unit tests (532 lines)
│
├── test-utils/                          # Shared test infrastructure
│   ├── mocks.js                         # ★ GAS global mocks (GmailApp, DriveApp, DocumentApp, etc. — 475 lines)
│   └── setup.js                         # Jest global setup (Session, Utilities, Logger stubs)
│
├── scripts/
│   └── check-coverage.js               # CI coverage threshold validator
│
├── .github/
│   ├── copilot-instructions.md          # Points to AGENTS.md
│   ├── dependabot.yml                   # Weekly npm + GitHub Actions updates
│   └── workflows/
│       ├── ci.yml                       # CI pipeline (lint, format, typecheck, autofix)
│       ├── codeql-analysis.yml          # Security scanning (JavaScript)
│       ├── coverage.yml                 # Coverage enforcement (100% lines)
│       ├── dependabot-automerge.yml     # Auto-merge minor/patch dependabot PRs
│       ├── nodejs-tests.yml             # Jest unit test runner
│       └── playwright-tests.yml         # Playwright E2E test runner
│
├── .husky/                              # Git hooks
│   ├── pre-commit                       # lint-staged + typecheck
│   └── commit-msg                       # commitlint (conventional commits)
│
├── package.json                         # ★ Root manifest — all dev dependencies
├── tsconfig.json                        # TypeScript config (noEmit, allowJs, ES2022)
├── eslint.config.js                     # ESLint flat config (typescript-eslint + prettier)
├── jest.config.js                       # Jest config (ts-jest, coverage thresholds)
├── playwright.config.js                 # Playwright config (chromium, .spec.js pattern)
├── commitlint.config.js                 # Conventional commits
├── .prettierrc                          # Prettier config (single quotes, no semi)
├── .pre-commit-config.yaml              # Pre-commit hooks (merge conflict, YAML check)
├── .gitignore                           # node_modules, coverage, test-results
├── AGENTS.md                            # AI agent guidelines
├── GEMINI.md                            # Points to AGENTS.md
├── README.md                            # Project overview and setup guide
├── LICENSE                              # MIT License
└── header.jpg                           # README header image
```

## Critical Folders

| Folder               | Purpose                                                       |
| -------------------- | ------------------------------------------------------------- |
| `src/`               | All automation script source code — the core of the project   |
| `src/*/src/index.js` | Extracted testable logic for each script (Node.js compatible) |
| `src/*/code.gs`      | GAS-native entry points (run in Google's environment)         |
| `src/*/config.gs`    | User configuration templates (populated by deploy UI)         |
| `deploy/`            | Browser-based deployment and configuration UI                 |
| `test-utils/`        | Shared GAS mock infrastructure (critical for all tests)       |
| `.github/workflows/` | CI/CD pipeline definitions                                    |

## Entry Points

| Entry Point                                                        | Context            | Description                          |
| ------------------------------------------------------------------ | ------------------ | ------------------------------------ |
| `src/gmail-to-drive-by-labels/code.gs:storeEmailsAndAttachments()` | GAS trigger        | Main Gmail processing function       |
| `src/gmail-to-drive-by-labels/code.gs:rebuildAllDocs()`            | GAS manual         | Rebuild all documents from scratch   |
| `src/calendar-to-sheets/code.gs:syncAllCalendarsToSheetsGAS()`     | GAS trigger        | Sync all configured calendars        |
| `src/calendar-to-sheets/code.gs:fullResyncCalendarToSheetGAS()`    | GAS manual         | Full historical resync               |
| `src/calendar-to-briefing-doc/code.gs:generateWeeklyBriefing()`    | GAS hourly trigger | Check schedule and generate briefing |
| `deploy/index.html`                                                | Browser            | Deployment and configuration UI      |
| `gas-installer/Code.gs:doGet()`                                    | GAS web app        | Legacy installer web UI              |
