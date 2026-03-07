# GitHub Copilot Instructions

This repository contains a collection of Google Apps Script (GAS) productivity tools for automating tasks across Gmail, Google Drive, and Google Docs.

---

## Repository layout

- `src/<script-name>/code.gs` — runnable Apps Script code
- `src/<script-name>/config.gs` — configuration values for the script
- `src/<script-name>/src/index.js` — Node.js-testable logic extracted from `code.gs`
- `src/<script-name>/tests/` — Jest unit tests
- `src/gas-utils.js` — shared utility functions (e.g. `getCleanBody`)
- `test-utils/` — shared Jest helpers and mocks
- `scripts/` — CI helper scripts (e.g. coverage threshold checks)

---

## Quick setup

```bash
npm install       # install all dependencies
npm test          # run the full test suite
npx jest "<agent-folder>/tests"   # run tests for a specific script
npm test -- --coverage            # run tests with coverage report
node scripts/check-coverage.js    # verify coverage meets thresholds
```

---

## Testing requirements

- **Follow TDD**: write tests before implementing features or bug fixes.
- **Minimum coverage thresholds**: 100% lines, 95% statements/functions, 85% branches.
- Run `npm test -- --coverage` and `node scripts/check-coverage.js` before opening a PR.
- Use **Jest** for all unit tests. Tests must be fast, deterministic, and must not access external networks.
- Mock all external services (Google Apps Script globals, HTTP calls) using helpers from `test-utils/`.
- **NEVER** use `.skip()` to avoid failing tests. Extract testable logic to `src/index.js` with `module.exports`, accepting GAS services as parameters. Tests inject global mocks via wrapper functions.
- **NEVER** add coverage ignore comments (`/* istanbul ignore next */`). Adjust thresholds or improve mocking instead.
- Integration tests must be clearly marked (e.g. `@integration`) and skippable in CI.

### Testing GAS functions

Google Apps Script `.gs` files cannot be `require()`-d in Jest. To test GAS logic:
1. Extract the function to `src/index.js` and export it with `module.exports`.
2. Accept GAS services (`GmailApp`, `DocumentApp`, etc.) as parameters rather than accessing globals.
3. In the test file, create a wrapper function that injects `global.GmailApp`, `global.DocumentApp`, etc.

GAS `code.gs` files may optionally include a guard for Jest imports:
```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ... };
}
```

---

## Code style & commits

- Run `npm run lint` and `npm test` before every commit.
- Run `npm test -- --coverage` before every commit.
- Keep commits small; include tests alongside behaviour changes.
- Follow existing code style — no new linting or build tooling unless essential.

---

## Repository conventions

- Each script's runnable code lives in `code.gs`; configuration lives in `config.gs`.
- Thread separators use 30 `=` signs (`==============================`).
- Thread deduplication embeds the Gmail thread ID in the separator: `------------------------------[THREAD:threadId]`.
- When prepending content into a Google Doc with `insertParagraph(0, ...)`, process items oldest-first so the newest content ends up at the top.
- `getCleanBody()` (in `src/gas-utils.js`) normalises line breaks: 3+ consecutive newlines → 2, and handles quoted-reply stripping.
- Always sort Gmail threads by last-message date before processing; the Gmail API does not guarantee order.

---

## Security & secrets

- **Never commit secrets.** Use GitHub Actions secrets or an external secret manager.
- Document all required secrets in the relevant `<script-name>/README.md`.
- Request maintainer review for any change requiring elevated permissions or access to sensitive data.
