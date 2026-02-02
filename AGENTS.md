# AGENTS.md — Agent Guidelines for this Repository

This file follows the AGENTS.md conventions (see https://agents.md/) and provides short, agent-friendly instructions for working with this repository. It is intended to be machine- and human-readable so coding agents and contributors can discover how to build, test, and interact with this project.

---

## Quick setup
- Install dependencies (root):
  - npm install
- Run the test suite locally:
  - npm test
- Run a specific package/tests (replace `<agent-folder>` with the folder path):
  - npx jest "<agent-folder>/tests"

---

## Why AGENTS.md?
AGENTS.md is for precise, agent-focused instructions that complement README files. Use it to document build steps, dev commands, test steps, and any non-obvious processes an automated tool should know.

---

## Agent operation guidance (canonical guidance adapted)
- Prefer interactive or dev commands when iterating (e.g., `npm run dev`) and avoid running production-only commands (e.g., `npm run build`) from an interactive agent session.
- Keep dependencies and lockfiles in sync. If you update deps, update the lockfile and restart relevant dev/test processes.
- Prefer small, focused commands for iterative work (run the specific tests you care about rather than the full suite when possible).
- Document any project-specific dev/test/run commands and required environment variables/secrets in this file or in `<agent-folder>/README.md`.

---

## Tests & CI (repo conventions)
- Use Jest for unit tests. Unit tests MUST be fast, deterministic, and not access external networks.
- Mock external services (Google Apps Script, HTTP calls) using `test-utils/` helpers where appropriate.
- Integration tests are allowed but MUST be clearly marked (e.g., `@integration`) and skippable in CI.
- The repository's `Node.js Tests` job runs package tests; ensure your package-level tests pass locally before opening a PR.

---

## Code style & commits
- Follow repository style and lint rules. Run `npm run lint` and `npm test` before committing.
- Keep commits small and include tests with behavior changes.

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
