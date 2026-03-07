# AGENTS.md — Agent Guidelines for this Repository

This file follows the AGENTS.md conventions (see https://agents.md/) and provides short, agent-friendly instructions for working with this repository. It is intended to be machine- and human-readable so coding agents and contributors can discover how to build, test, and interact with this project.

> **GitHub Copilot users:** `.github/copilot-instructions.md` points here as the single source of truth.

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
- Install dependencies (root):
  - `npm install`
- Run the test suite locally:
  - `npm test`
- Run a specific package/tests (replace `<agent-folder>` with the folder path):
  - `npx jest "<agent-folder>/tests"`
- Run tests with coverage report:
  - `npm test -- --coverage`
- Verify coverage meets thresholds:
  - `node scripts/check-coverage.js`

---

## Agent operation guidance (canonical guidance adapted)
- Prefer interactive or dev commands when iterating (e.g., `npm run dev`) and avoid running production-only commands (e.g., `npm run build`) from an interactive agent session.
- Keep dependencies and lockfiles in sync. If you update deps, update the lockfile and restart relevant dev/test processes.
- Prefer small, focused commands for iterative work (run the specific tests you care about rather than the full suite when possible).
- Document any project-specific dev/test/run commands and required environment variables/secrets in this file or in `<agent-folder>/README.md`.
- Repository convention: place runnable Apps Script code in `code.gs` and configuration in `config.gs` within each script folder.

---

## Tests & CI (repo conventions)
- **Follow Test-Driven Development (TDD): write tests before implementing features or bug fixes.** Add tests first and iterate until they pass; include the tests in the same PR as the implementation.
- **Achieve and maintain excellent test coverage.** Minimum thresholds: 100% lines, 95% statements/functions, 85% branches. Verify locally with `npm test -- --coverage` (or `npx jest --coverage`) and ensure CI coverage meets these requirements. PRs that reduce coverage below these thresholds will be rejected.
- **NEVER add coverage "ignore" comments (e.g., `/* istanbul ignore next */`) to artificially boost test coverage.** If code is truly difficult to test, adjust coverage thresholds or improve mocking strategies instead. Coverage ignore comments mask untested code and are not acceptable.
- Use Jest for unit tests. Unit tests MUST be fast, deterministic, and not access external networks.
- Mock external services (Google Apps Script, HTTP calls) using `test-utils/` helpers where appropriate.
- **NEVER** use `.skip()` to avoid failing tests. Extract testable logic to `src/index.js` with `module.exports`, accepting GAS services as parameters. Tests inject global mocks via wrapper functions.
- Integration tests are allowed but MUST be clearly marked (e.g., `@integration`) and skippable in CI.
- The repository's `Node.js Tests` job runs package tests; ensure your package-level tests pass locally before opening a PR.

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
- Follow repository style and lint rules.
  - ALWAYS ensure `npm run lint` and `npm test` passes before committing.
  - ALWAYS ensure `npm test -- --coverage` passes before committing.
- Keep commits small and include tests with behavior changes.
- Follow existing code style — no new linting or build tooling unless essential.

---

## Repository conventions

- Each script's runnable code lives in `code.gs`; configuration lives in `config.gs`.
- Thread separators use 30 `=` signs (`==============================`).
- Thread deduplication embeds the Gmail thread ID in the separator: `------------------------------[THREAD:threadId]`.
- When prepending content into a Google Doc with `insertParagraph(0, ...)`, process items oldest-first so the newest content ends up at the top.
- `getCleanBody()` (in `src/gas-utils.js`) normalizes line breaks: 3+ consecutive newlines → 2, and handles quoted-reply stripping.
- Always sort Gmail threads by last-message date before processing; the Gmail API does not guarantee order.

---

## Security & secrets
- Never commit secrets. Use GitHub Actions secrets or an external secret manager and document required secrets in `<agent-folder>/README.md`.
- Request maintainer review for agents requiring elevated permissions or access to sensitive data.

---

## How to use this file
- Agents will read the nearest AGENTS.md (this one is at the repo root).
- If a subproject needs different guidance, it may include its own `AGENTS.md` or a clear `README.md` explaining the differences.

---

## References
- AGENTS.md canonical guidance: https://agents.md/
- Example repository: https://github.com/agentsmd/agents.md/blob/main/AGENTS.md
