# Agents Development Guide — short pointer

This project's canonical agent guidance is now the repository-level `AGENTS.md` at the repo root. That file follows the AGENTS.md convention (https://agents.md/) and contains machine- and human-oriented instructions for building, testing, and operating agents in this repo.

Quick references:

- Canonical file: `/AGENTS.md` ✅
- Agents live under: `agents/<agent-name>/` ✅
- Run tests locally: `npm test` (or `npx jest "agents/<name>/tests"`) ✅
- CI: `Node.js Tests` job (repository-level) runs tests for any package that contains `tests/` ✅

If you prefer, I can convert this short doc into a full `AGENTS.md` at the project root (I already added one) or scaffold a sample agent (implementation + tests + optional workflow) in a new branch — tell me the agent name and trigger type (scheduled / webhook / manual) and I’ll create a scaffold.