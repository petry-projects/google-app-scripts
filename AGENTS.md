# AGENTS.md — Agent Guidance for this Repository

This file follows the AGENTS.md conventions (see https://agents.md/) and provides agent-focused, machine- and human-readable instructions for implementing, testing, and operating agents in this repository.

---

## Why this file exists
- Use AGENTS.md for agent-specific developer instructions (build, test, run, configuration) that complement `README.md` files.
- Agents and automation tools will read the nearest `AGENTS.md` to decide how to build and test a package.

---

## Project layout & where to put agent code
- Agent code should be placed in a clearly documented folder; record its path in `AGENTS.md` or the agent's `README.md`.

Recommended layout example:

- <agent-folder>/
  - README.md            # purpose, configuration, secrets required
  - src/                 # implementation (keep pure logic testable)
  - tests/               # unit and optional integration tests
  - package.json         # optional, only if agent has separate deps or scripts
  - .github/workflows/   # optional per-agent workflows

For monorepos or nested projects, you MAY place an `AGENTS.md` inside a package—agents will prefer the nearest file.

---

## Quick start (dev environment)
- Install repository dependencies (root):
  - npm install
- Run tests for an agent:
  - npm test -- "<agent-folder>/tests"  (or run `npx jest "<agent-folder>/tests"`)
- Run the repository test suite locally before opening a PR:
  - npm test

---

## Agent operation guidance (adopted from https://agents.md/)
These short rules reflect the canonical AGENTS.md guidance and are adapted for this repository so agent-driven tooling behaves predictably:

- Use interactive/dev commands or test commands during agent sessions; avoid running destructive or production-only workflows from an interactive agent session.
- Keep dependencies in sync: update the lockfile (`package-lock.json`/`pnpm-lock.yaml`/`yarn.lock`) when adding or changing dependencies and restart any local dev/test servers.
- Prefer small, focused commands for iterative work (e.g., run the specific agent tests instead of the full suite).
- Document project-specific commands and any environment variables/secrets needed in `<agent-folder>/README.md`.

---

## Tests & CI conventions
- Use Jest (the repo default) for unit tests.
- Unit tests MUST be fast, deterministic, and not access external networks.
- Mock external services (Google Apps Script, HTTP calls) using `test-utils/` helpers.
- Integration tests are allowed but MUST be clearly marked (e.g., `@integration`) and skippable in CI.
- Agent tests are discovered by the repository-level `Node.js Tests` job; ensure `<agent-folder>/tests` passes on CI.

---

## Code style and types
- Follow repo conventions (JavaScript, tests with Jest). If an agent uses TypeScript, add tsconfig and keep strict typing.
- Keep module initialization free of side effects for testability.

---

## Security & secrets
- Never store secrets in the repo. Use GitHub Secrets or an external secret manager and document required secrets in `<agent-folder>/README.md`.
- Limit permissions and document the minimal scope required. Anything that requires elevated permissions must be reviewed by maintainers.

---

## Observability, retries, and idempotency
- Agents MUST log lifecycle events and errors with enough context for debugging.
- Implement retries for transient errors with exponential backoff and a bounded retry count.
- Design agents to be idempotent and add tests to cover repeated runs.

---

## PR checklist for agent changes
Add the following to your PR description or use it as a template:
- [ ] Agent `README.md` included and documents config + secrets
- [ ] Unit tests added and passing
- [ ] Integration tests added only if required and marked/skippable
- [ ] CI workflow included (if agent needs extra verification) or note that repo-level CI runs the tests
- [ ] Security notes and required maintainer approval if running with elevated permissions

Include short notes about how to trigger the agent (schedule, manual, webhook) and how to run tests locally.

---

## Example scaffold
1. mkdir -p <agent-folder>/src <agent-folder>/tests
2. Add implementation to `src/` and tests to `tests/`
3. Run tests: `npx jest "<agent-folder>/tests"`
4. Add `README.md` and open a PR with the PR checklist above

---

## Repo-level rules & enforcement (required)
To keep agent contributions consistent and safe, this repository applies the following required rules:

- **Coverage threshold**: Agent code SHOULD meet a minimum **global coverage of 80%** (lines, statements, branches, functions). A template workflow `.github/workflows/agent-workflow-template.yml` demonstrates running tests and enforcing the coverage threshold via `coverage/coverage-summary.json`.

- **Per-agent workflows**: If your agent needs extra verification (container build, release, or scheduled triggers), add a per-agent workflow in `<agent-folder>/.github/workflows/` using the template above.

Notes:
- Maintainers may adjust thresholds per-agent via PR discussion; the default baseline is 80% global coverage.

---

## Where to learn more
- AGENTS.md reference: https://agents.md/
- Agent ecosystem examples: https://github.com/search?q=path%3AAGENTS.md+NOT+is%3Afork

---

If you'd like, I can scaffold a concrete example agent (code + tests + optional workflow) that follows this `AGENTS.md`. Reply with the agent name and trigger type (scheduled / manual / webhook) and I’ll create the scaffold in a new branch.