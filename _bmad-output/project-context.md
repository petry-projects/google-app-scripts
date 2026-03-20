---
project_name: 'google-app-scripts'
user_name: 'Donpetry'
date: '2026-03-20'
sections_completed:
  [
    'technology_stack',
    'language_rules',
    'framework_rules',
    'testing_rules',
    'quality_rules',
    'workflow_rules',
    'anti_patterns',
  ]
status: 'complete'
optimized_for_llm: true
---

# Project Context for AI Agents

_This file contains critical rules and patterns that AI agents must follow when implementing code in this project. Focus on unobvious details that agents might otherwise miss._

---

## Technology Stack & Versions

- **Runtime:** Node.js ≥20 (local testing only — GAS runs in Google's V8)
- **Language:** JavaScript (GAS `.gs`) + TypeScript ^5.9.3 (local/test layer)
- **Target:** ES2022, module system: CommonJS (`require`/`module.exports`)
- **Test runner:** Jest ^30.3.0 with ts-jest ^29.4.6 (`js-with-ts` preset)
- **E2E:** Playwright ^1.58.2
- **Linting:** ESLint ^10.0.3 (flat config) + @typescript-eslint ^8.57.0
- **Formatting:** Prettier ^3.8.1
- **Git hooks:** Husky ^9.1.7 + lint-staged ^16.4.0
- **Commit format:** Conventional Commits via commitlint ^20.5.0
- **GAS types:** @types/google-apps-script ^2.0.8
- **TypeScript:** strict mode ON, `allowJs: true`, `checkJs: false`

### Language-Specific Rules

- **Dual-layer architecture:** GAS code lives in `code.gs`; all testable logic MUST be extracted to `src/index.js` with `module.exports` so Jest can import it
- **GAS globals are never importable** — inject them as parameters (e.g., `SpreadsheetApp`, `CalendarApp`, `MailApp`); tests inject mocks via wrappers
- **No `import`/`export` (ESM)** — use `require`/`module.exports` throughout; ESM is not supported in GAS or the CommonJS test layer
- **No semicolons** — Prettier enforces this; never add them
- **Single quotes** for strings; trailing commas (ES5 style); print width 80
- **TypeScript is for type-checking only** (`noEmit: true`) — never compile TS to output; all runtime code stays as `.js` or `.gs`
- **`checkJs: false`** — JS files are not type-checked; only `.ts` files are
- **Async/await:** not available in GAS runtime — use synchronous GAS APIs only inside `.gs` files; async is fine in Node.js test/utility code

### Framework-Specific Rules (Google Apps Script)

- **Script layout per folder:** `code.gs` (GAS entry points), `config.gs` (configuration values), `src/index.js` (extracted testable logic), `tests/` (Jest unit tests) — never deviate from this structure
- **`code.gs` calls `src/index.js`** — GAS functions are thin wrappers that pass GAS service globals into the extracted logic; no business logic in `.gs`
- **Shared utilities** go in `src/gas-utils.js` (root-level), imported by individual script `src/index.js` files
- **Configuration values** (IDs, labels, folder names) belong in `config.gs`, never hardcoded in `code.gs` or `src/index.js`
- **GAS triggers** (time-based, event-based) are set up in `code.gs` only; document trigger setup in the script's `README.md`
- **No `console.log` in `.gs`** — use `Logger.log()` for GAS-side logging; `console.log` is fine in `src/index.js` for local debugging
- **`test-utils/mocks.js`** provides `installGlobals(global)` / `resetAll(global)`; always call `installGlobals` in `beforeEach` and `resetAll` in `afterEach`

### Testing Rules

- **TDD is mandatory** — write tests before implementation; tests and code ship in the same PR
- **Coverage thresholds (enforced in CI):**
  - Lines: 99% | Statements: 95% | Functions: 95% | Branches: 85%
  - Verify locally: `npm test -- --coverage` then `node scripts/check-coverage.js`
- **Test file location:** `src/<script-name>/tests/*.test.js` — matched by `**/tests/**/*.test.[jt]s?(x)`
- **Never use `.skip()`** — if a test fails, fix it; never skip to make CI pass
- **Never use coverage-ignore pragmas** (`/* istanbul ignore */`, `/* c8 ignore */`) — improve tests or mocking instead
- **GAS functions are not directly testable** — extract logic to `src/index.js`, accept GAS services as parameters, test the extracted module
- **Mock all external services** using `test-utils/` helpers; unit tests must be fast, deterministic, and make zero network calls
- **Integration tests** must be clearly marked (e.g., `@integration`) and skippable in CI
- **Run targeted tests** during iteration: `npx jest "<script-folder>/tests"`

### Code Quality & Style Rules

- **Prettier is the source of truth for formatting** — config: single quotes, no semicolons, trailing commas (ES5), print width 80; runs automatically via lint-staged on commit
- **ESLint uses flat config** (`eslint.config.js`) — not `.eslintrc`; do not create legacy config files
- **File naming:** kebab-case for folders and script names (e.g., `gmail-to-drive-by-labels`); camelCase for functions and variables
- **Test file naming:** `<descriptor>.test.js` inside a `tests/` subfolder
- **Exports:** each `src/index.js` exports only the functions needed by tests and `code.gs`; avoid exporting internal helpers unless tested directly
- **Comments:** only where logic is non-obvious; do not comment self-evident code
- **`typecheck` script** (`tsc --noEmit`) must pass — fix type errors, do not suppress with `@ts-ignore` unless absolutely unavoidable with explanation
- **`npm run check`** (Prettier + ESLint) must pass before opening a PR

### Development Workflow Rules

- **Branch naming:** `copilot/<feature-name>` for AI-assisted work; `fix/<description>` for bug fixes; kebab-case throughout
- **Commit messages:** Conventional Commits enforced by commitlint — `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:` prefixes required; scope optional e.g. `fix(calendar-to-sheets): ...`
- **PR checklist before requesting review:**
  1. `npm test` — all tests pass
  2. `npm test -- --coverage` — thresholds met
  3. `node scripts/check-coverage.js` — coverage script passes
  4. `npm run check` — Prettier + ESLint clean
- **Dependabot PRs** auto-merge after CI passes — do not manually merge them
- **Each new GAS script** gets its own folder under `src/` following the established layout; add a `README.md` documenting triggers and setup
- **Never push directly to `main`** — all changes via PR
- **Resolve all PR review threads** after addressing comments before re-requesting review

### Critical Don't-Miss Rules

- **NEVER put business logic in `code.gs`** — it cannot be unit tested; always extract to `src/index.js`
- **NEVER call GAS APIs directly in `src/index.js`** — accept them as function parameters so tests can inject mocks
- **NEVER use `async`/`await` in `.gs` files** — GAS runtime is synchronous; it will silently fail or error
- **NEVER hardcode IDs, sheet names, or labels** — all config goes in `config.gs`
- **NEVER use `.skip()` or coverage-ignore pragmas** to get CI green — fix the underlying issue instead
- **NEVER add a new script without tests** — CI will reject PRs below coverage thresholds
- **NEVER use ESM `import`/`export`** — the entire stack (GAS + Jest) is CommonJS
- **NEVER create `.eslintrc`** — the project uses ESLint flat config only; legacy config files will conflict
- **Shared mock helpers live in `test-utils/`** — do not duplicate mock implementations inside individual test files
- **`config.gs` is not testable** — keep it as pure key/value declarations with no logic

---

## Usage Guidelines

**For AI Agents:**

- Read this file before implementing any code
- Follow ALL rules exactly as documented
- When in doubt, prefer the more restrictive option
- Update this file if new patterns emerge

**For Humans:**

- Keep this file lean and focused on agent needs
- Update when technology stack changes
- Review quarterly for outdated rules
- Remove rules that become obvious over time

Last Updated: 2026-03-20
