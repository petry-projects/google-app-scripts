# GitHub Copilot Instructions

All instructions for this repository are maintained in [`AGENTS.md`](../AGENTS.md) at the repository root.

Please read and follow the guidance in that file.

## Tech Stack

- **Runtime:** Google Apps Script (V8) for deployed code; Node.js for tooling and tests
- **Language:** JavaScript (`.gs` / `.js`), with TypeScript available for type checking (`npm run typecheck`)
- **Testing:** Jest (unit, `npm test`) · Playwright (e2e, `npm run test:e2e`)
- **Linting:** ESLint + Prettier (`npm run check`)
- **Coverage thresholds:** 99% lines, 95% statements/functions, 85% branches
- **Key libraries:** `@types/google-apps-script` (GAS type defs), `ts-jest`, `husky` + `lint-staged` (pre-commit), `@commitlint` (conventional commits)

## Local Dev Commands

- **Install:** `npm install`
- **Test (unit):** `npm test`
- **Test (unit + coverage):** `npm test -- --coverage`
- **Test (e2e):** `npm run test:e2e`
- **Lint + format check:** `npm run check`
- **Lint only:** `npm run lint`
- **Format:** `npm run format`
- **Typecheck:** `npm run typecheck`

> **Dev run:** Deployed code runs in Google Apps Script, not locally — there is no local dev server. Push code to Apps Script (via the Apps Script editor or `clasp`) to run it. Extracted logic in `src/<script-name>/src/index.js` is exercised through `npm test`.
