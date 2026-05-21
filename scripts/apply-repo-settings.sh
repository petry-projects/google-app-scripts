#!/usr/bin/env bash
# apply-repo-settings.sh
#
# Applies required settings to the repository via the GitHub API:
#
# Security settings (per push-protection standard):
# https://github.com/petry-projects/.github/blob/main/standards/push-protection.md#required-repo-level-settings
#   1. Enables secret scanning
#   2. Enables secret scanning push protection
#   3. Enables secret scanning AI detection
#   4. Enables secret scanning non-provider patterns
#   5. Enables Dependabot security updates
#
# Check-suite auto-trigger settings (per github-settings standard):
# https://github.com/petry-projects/.github/blob/main/standards/github-settings.md
#   6. Disables CodeRabbit (347564) check-suite auto-trigger
#   7. Disables Claude (1236702) check-suite auto-trigger
#
# Prerequisites: gh (authenticated with admin access to the repository)
# Usage:
#   bash scripts/apply-repo-settings.sh                          # current repo
#   bash scripts/apply-repo-settings.sh owner/other-repo         # specific repo

set -euo pipefail

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

echo "=== Apply Repo Security Settings ==="
echo "  Repo: $REPO"
echo ""

# ── Preflight ─────────────────────────────────────────────────────────────────
for cmd in gh; do
  command -v "$cmd" >/dev/null || { echo "Error: $cmd is required"; exit 1; }
done
gh auth status >/dev/null 2>&1 || { echo "Error: gh not authenticated"; exit 1; }

# ── Apply security_and_analysis settings ──────────────────────────────────────
echo "Applying security_and_analysis settings..."

gh api -X PATCH "repos/$REPO" --input - <<'JSON'
{
  "security_and_analysis": {
    "secret_scanning":                      {"status": "enabled"},
    "secret_scanning_push_protection":      {"status": "enabled"},
    "secret_scanning_ai_detection":         {"status": "enabled"},
    "secret_scanning_non_provider_patterns":{"status": "enabled"},
    "dependabot_security_updates":          {"status": "enabled"}
  }
}
JSON

echo "  ✓ secret_scanning"
echo "  ✓ secret_scanning_push_protection"
echo "  ✓ secret_scanning_ai_detection"
echo "  ✓ secret_scanning_non_provider_patterns"
echo "  ✓ dependabot_security_updates"

# ── Disable check-suite auto-triggers ─────────────────────────────────────────
# CodeRabbit (347564) and Claude (1236702) create queued check suites on every
# push but only complete them when they have actual work to do. Leaving
# auto-trigger enabled permanently blocks auto-merge because GitHub waits for
# all check suites to reach a terminal state.
echo ""
echo "Disabling check-suite auto-triggers..."

gh api -X PATCH "repos/$REPO/check-suites/preferences" --input - <<'JSON'
{
  "auto_trigger_checks": [
    {"app_id": 347564, "setting": false},
    {"app_id": 1236702, "setting": false}
  ]
}
JSON

echo "  ✓ CodeRabbit (347564) auto-trigger disabled"
echo "  ✓ Claude (1236702) auto-trigger disabled"

# ── Verify ────────────────────────────────────────────────────────────────────
echo ""
echo "Verifying settings..."
gh api "repos/$REPO" --jq '.security_and_analysis'

echo ""
echo "=== Done for $REPO ==="
