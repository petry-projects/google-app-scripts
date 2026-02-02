# Agents Development Guide (Rules & Conventions)

This document provides explicit rules, conventions, and examples for implementing agents in this repository. Follow these guidelines to ensure consistency, testability, security, and maintainability.

---

## 1) Agent structure (required)
Every agent MUST live under the top-level `agents/` folder and follow this layout:

- agents/<agent-short-name>/
  - README.md            # Purpose, configuration, runtime requirements (required)
  - src/                 # Implementation files (required)
  - tests/               # Unit and integration tests (required)
  - package.json         # If the agent has dependencies or needs its own scripts (optional)
  - Dockerfile           # Only if containerized (optional)
  - .github/workflows/   # Optional per-agent workflows (name clearly)

Notes:
- Keep pure logic inside `src/` so unit tests can run without platform dependencies.
- Agent code SHOULD avoid using global state; prefer explicit inputs/outputs and dependency injection.

---

## 2) Naming convention (required)
- Agent directory: `agents/<short-kebab-name>` (lowercase, hyphen separated, e.g. `agent-cleanup-archives`).
- Branches: `feat/agent-<short-kebab-name>-<short-desc>` (e.g., `feat/agent-cleanup-archives-schedule`).
- PR title: `feat(agent): <short description>` (e.g., `feat(agent): add scheduled cleanup agent`).
- Files: use `kebab-case` or `camelCase` consistently; prefer `kebab-case` for filenames and directories.

---

## 3) Unit testing strategy (required)
- Unit tests MUST reside in `agents/<name>/tests/` and use Jest (project default).
- Tests should only cover deterministic, pure logic in `src/`. Any platform integrations (Google services, HTTP calls) MUST be mocked.
- Use the repo's `test-utils/` helpers for common mocks (e.g., Google Apps Script mocks) — extend these helpers rather than duplicating logic.
- Each agent MUST have tests that assert:
  - Core logic correctness for edge cases (e.g., empty inputs, error conditions).
  - Failure handling and retry/backoff logic.
  - Deduplication or idempotency behavior where applicable.

Test strategy details:
- Unit tests: fast, no network, use mocks.
- Integration tests: optional, keep them isolated and mark with `@integration` or similar tag. CI should be able to skip them unless explicitly enabled.
- Coverage: each agent should aim for reasonable coverage; add coverage thresholds at repo-level later (optional enhancement).

---

## 4) CI & workflows (required)
- All agents with `tests/` will be discovered by the repository-level `Node.js Tests` job. Ensure tests pass locally with `npm test` or `npx jest "agents/<name>/tests"`.
- If an agent requires additional verification (container build, release), include a `.github/workflows/agent-<name>.yml` workflow in the agent folder or in `.github/workflows/`.
- Workflow files that run in PRs must be added through a branch with workflow permission (GitHub may require `workflow` scope to push them). If you cannot push the workflow, add it via the PR UI or ask a maintainer.

---

## 5) Security and secrets (required)
- Do not store secrets in code. Use GitHub Actions secrets or an external secret manager.
- Limit secrets to the narrowest scope needed and document which secrets are required in the agent `README.md`.
- Agents running with elevated permissions require explicit approval from a maintainer and a short security plan in the PR description.

---

## 6) Observability, retries, and idempotency (required)
- Agents MUST log key lifecycle events and errors with enough context to debug (timestamp, job id, inputs sanitized).
- Implement retries with exponential backoff for transient errors. Fail after a bounded number of attempts and surface errors to monitoring.
- Agents must be idempotent: repeated executions with the same input should not cause duplicate side effects. Tests must cover idempotency behavior.

---

## 7) Pull Request rules (required)
When opening a PR for an agent change, include the following in the PR description:
- Short summary of what the agent does.
- How it will be triggered (schedule / webhook / manual / workflow).
- What permissions or secrets it requires.
- Test plan and how to run tests locally (commands).
- A short security and data-retention note (where data is stored, who can access it).

Checklist in PR description (use as a template):
- [ ] README.md exists and documents configuration and secrets
- [ ] Unit tests added and passing
- [ ] Integration tests added (if applicable) and marked/skippable
- [ ] CI workflow included or verification that repo-level CI runs tests
- [ ] Security review notes included and maintainer approval requested (if required)

---

## 8) Code quality & review (required)
- Keep functions small and focused.
- Add JSDoc comments for exported functions and complex logic.
- Avoid side effects in module initialization.
- Add meaningful unit tests that validate behavior, not implementation details.

---

## 9) Example: Agent scaffold (recommended)
Create the following files to scaffold a new agent:

- agents/agent-cleanup-archives/README.md
- agents/agent-cleanup-archives/src/index.js
- agents/agent-cleanup-archives/tests/index.test.js
- agents/agent-cleanup-archives/.github/workflows/agent-cleanup-archives.yml (optional)

Quick test commands:
- Run unit tests: npx jest "agents/agent-cleanup-archives/tests"

---

## 10) Maintainers & contact
- Tag `@petry-projects` or open an issue/PR and request a review from a maintainer for agent changes requiring infra or security approval.

---

If you'd like, I can scaffold an example agent (implementation + tests + optional workflow) in a new branch following these rules. Should I create that scaffold now?
