#!/usr/bin/env bash
# setup-pr-quality-ruleset.sh
#
# Creates the org-standard "pr-quality" repository ruleset, which enforces
# pull-request reviews and blocks force-pushes on the default branch.
#
# Standard reference:
#   https://github.com/petry-projects/.github/blob/main/standards/github-settings.md#pr-quality--standard-ruleset-all-repositories
#
# What this script does:
#   1. Checks whether the "pr-quality" ruleset already exists
#   2. Creates it if missing (idempotent — safe to re-run)
#
# Prerequisites: gh (authenticated with repo admin rights)
# Usage:
#   bash scripts/setup-pr-quality-ruleset.sh                  # current repo
#   bash scripts/setup-pr-quality-ruleset.sh owner/other-repo # specific repo

set -euo pipefail

RULESET_NAME="pr-quality"

# Target repo: first arg, or detect from current directory
if [ -n "${1:-}" ]; then
  REPO="$1"
else
  REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)"
  if [ -z "$REPO" ]; then
    echo "Usage: $0 [owner/repo]"
    exit 1
  fi
fi

echo "=== pr-quality Ruleset Setup ==="
echo "  Ruleset: $RULESET_NAME"
echo "  Repo:    $REPO"
echo ""

# ── Preflight ─────────────────────────────────────────────────────────────────
command -v gh >/dev/null || { echo "Error: gh CLI is required"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Error: gh not authenticated"; exit 1; }

# ── Check if ruleset already exists ───────────────────────────────────────────
EXISTING_ID=$(gh api "repos/$REPO/rulesets" -q ".[] | select(.name == \"$RULESET_NAME\") | .id" 2>/dev/null || echo "")

if [ -n "$EXISTING_ID" ]; then
  echo "  ✓ '$RULESET_NAME' ruleset already exists (id: $EXISTING_ID) — nothing to do."
  echo ""
  echo "=== Done ==="
  exit 0
fi

# ── Create the pr-quality ruleset ─────────────────────────────────────────────
echo "Creating '$RULESET_NAME' ruleset..."

gh api "repos/$REPO/rulesets" --method POST --input - <<'JSON'
{
  "name": "pr-quality",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "include": ["~DEFAULT_BRANCH"],
      "exclude": []
    }
  },
  "rules": [
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": true
      }
    },
    {
      "type": "non_fast_forward"
    }
  ]
}
JSON

echo "  ✓ '$RULESET_NAME' ruleset created successfully."
echo ""
echo "=== Done ==="
