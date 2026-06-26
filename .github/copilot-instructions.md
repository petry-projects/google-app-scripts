# GitHub Copilot Instructions

All instructions for this repository are maintained in [`AGENTS.md`](../AGENTS.md) at the repository root.

Please read and follow the guidance in that file.

## Tech Stack

- **Runtime:** Google Apps Script (V8) for deployed code; Node.js for tooling and tests
- **Language:** JavaScript (`.gs` / `.js`), with TypeScript available for type checking (`tsc --noEmit`)
- **Testing:** Jest (unit, `npm test`) · Playwright (e2e, `npm run test:e2e`)
- **Linting:** ESLint + Prettier (`npm run check`)
- **Coverage thresholds:** 100% lines, 95% statements/functions, 85% branches
- **Key libraries:** `@types/google-apps-script` (GAS type defs), `ts-jest`, `husky` + `lint-staged` (pre-commit), `@commitlint` (conventional commits)
