# GitHub Copilot Instructions

All instructions for this repository are maintained in [`AGENTS.md`](../AGENTS.md) at the repository root.

Please read and follow the guidance in that file.

## Tech Stack

- **Platform:** Google Apps Script (V8 runtime, deployed on Google Workspace)
- **Language:** JavaScript (`.gs` files for GAS entry points, `.js` for testable logic)
- **Testing:** Jest (`npm test` / `npx jest --runInBand`), with 100% line coverage required
- **Linting:** ESLint (`npm run lint`)
- **Formatting:** Prettier (`npx prettier --write .`)
- **Package Manager:** npm
- **Google Services:** GmailApp, DriveApp, CalendarApp, DocumentApp, SpreadsheetApp (injected as parameters for testability)
- **CI:** GitHub Actions — runs Jest tests and coverage checks on every PR
