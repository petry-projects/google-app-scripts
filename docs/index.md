# Project Documentation Index

**Generated:** 2026-03-28 | **Scan Level:** Exhaustive | **Mode:** Initial Scan

## Project Overview

- **Type:** Monolith — single repository with multiple automation scripts
- **Primary Language:** JavaScript (Google Apps Script + Node.js)
- **Architecture:** Dual-runtime script collection with browser-based deployment layer
- **License:** MIT

## Quick Reference

- **Tech Stack:** Google Apps Script (V8), Node.js 20, Jest, Playwright, TypeScript (noEmit), ESLint, Prettier
- **Entry Points:** `src/*/code.gs` (GAS triggers), `deploy/index.html` (browser deployment UI)
- **Architecture Pattern:** GAS scripts with extracted testable logic + static HTML deployment SPA
- **Test Coverage:** 100% lines, 95% statements/functions, 85% branches

### Script Catalog

| Script                   | Purpose                                   | GAS Entry Point                 |
| ------------------------ | ----------------------------------------- | ------------------------------- |
| gmail-to-drive-by-labels | Archive Gmail → Google Doc + Drive folder | `storeEmailsAndAttachments()`   |
| calendar-to-sheets       | Sync Calendar → Google Sheets             | `syncAllCalendarsToSheetsGAS()` |
| calendar-to-briefing-doc | Weekly calendar briefing → email          | `generateWeeklyBriefing()`      |

## Generated Documentation

- [Project Overview](./project-overview.md) — Executive summary, tech stack, architecture type
- [Architecture](./architecture.md) — System design, key decisions, script details, testing strategy
- [Source Tree Analysis](./source-tree-analysis.md) — Annotated directory tree, critical folders, entry points
- [Component Inventory](./component-inventory.md) — All functions, UI sections, test infrastructure
- [Development Guide](./development-guide.md) — Setup, commands, workflow, conventions, CI/CD
- [Deployment Guide](./deployment-guide.md) — Deployment methods, post-deployment setup, GCP config

## Existing Documentation

- [README.md](../README.md) — Project overview, script catalog, getting started guide
- [AGENTS.md](../AGENTS.md) — AI agent coding conventions, test rules, repo layout
- [src/gmail-to-drive-by-labels/README.md](../src/gmail-to-drive-by-labels/README.md) — Gmail archiving script docs
- [src/calendar-to-sheets/README.md](../src/calendar-to-sheets/README.md) — Calendar sync script docs
- [src/calendar-to-briefing-doc/README.md](../src/calendar-to-briefing-doc/README.md) — Calendar briefing script docs

## Getting Started

### For Development

1. Clone the repository and run `npm install`
2. Run tests: `npm test`
3. Read the [Development Guide](./development-guide.md) for workflow and conventions

### For Deployment

1. Open `deploy/index.html` in your browser
2. Sign in with Google and deploy scripts to your account
3. Read the [Deployment Guide](./deployment-guide.md) for full instructions

### For AI-Assisted Development

1. Start with this index for project orientation
2. Read [Architecture](./architecture.md) for system design decisions
3. Read [Component Inventory](./component-inventory.md) for function-level detail
4. Reference script-specific READMEs for domain context
