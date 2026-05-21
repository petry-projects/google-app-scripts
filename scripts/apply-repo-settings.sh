#!/usr/bin/env bash
# apply-repo-settings.sh
#
# Applies required security_and_analysis settings to the repository via the
# GitHub API, per the push-protection standard:
# https://github.com/petry-projects/.github/blob/main/standards/push-protection.md#required-repo-level-settings
#
# What this script does:
#   1. Enables secret scanning
#   2. Enables secret scanning push protection
#   3. Enables secret scanning AI detection
#   4. Enables secret scanning non-provider patterns
#   5. Enables Dependabot security updates
#   6. Disables check-suite auto-trigger for the Claude app (ID 1236702)
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

# ── Disable check-suite auto-trigger for Claude app ───────────────────────────
# Claude (app ID 1236702) creates queued check suites on every push that never
# complete, permanently blocking auto-merge. Setting auto_trigger_checks=false
# stops GitHub from creating suites on every push; the app still creates suites
# explicitly when it has work to report.
# Reference: https://github.com/petry-projects/.github/blob/main/standards/github-settings.md
echo ""
echo "Disabling check-suite auto-trigger for Claude app (ID 1236702)..."

gh api -X PATCH "repos/$REPO/check-suites/preferences" --input - <<'JSON'
{
  "auto_trigger_checks": [
    {
      "app_id": 1236702,
      "setting": false
    }
  ]
}
JSON

echo "  ✓ check-suite auto-trigger disabled for Claude app (1236702)"

# ── Verify ────────────────────────────────────────────────────────────────────
echo ""
echo "Verifying settings..."
gh api "repos/$REPO" --jq '.security_and_analysis'
echo ""
echo "Verifying check-suite preferences..."
gh api "repos/$REPO/check-suites/preferences" --jq '.preferences.auto_trigger_checks'

echo ""
echo "=== Done for $REPO ==="
