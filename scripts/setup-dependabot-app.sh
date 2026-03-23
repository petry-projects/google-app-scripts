#!/usr/bin/env bash
# setup-dependabot-app.sh
#
# Configures a repository to use the org-wide "dependabot-automerge-petry"
# GitHub App for Dependabot auto-merge. The app must already be created and
# installed on the org (see PR #71 for context).
#
# What this script does:
#   1. Stores APP_ID and APP_PRIVATE_KEY as repo secrets
#   2. Adds the app to the repo's ruleset bypass list (if a matching ruleset exists)
#   3. Copies the dependabot-automerge workflow into the repo
#
# Prerequisites: gh (authenticated), python3
# Usage:
#   bash scripts/setup-dependabot-app.sh                          # current repo
#   bash scripts/setup-dependabot-app.sh owner/other-repo         # specific repo
#   APP_PRIVATE_KEY_FILE=path/to/key.pem bash scripts/setup-dependabot-app.sh

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
APP_ID="${APP_ID:-3167543}"
APP_NAME="dependabot-automerge-petry"
RULESET_NAME="${RULESET_NAME:-protect-branches}"

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

echo "=== Dependabot Auto-Merge Setup ==="
echo "  App:  $APP_NAME (ID: $APP_ID)"
echo "  Repo: $REPO"
echo ""

# ── Preflight ─────────────────────────────────────────────────────────────────
for cmd in gh python3; do
  command -v "$cmd" >/dev/null || { echo "Error: $cmd is required"; exit 1; }
done
gh auth status >/dev/null 2>&1 || { echo "Error: gh not authenticated"; exit 1; }

# ── Step 1: Store secrets ─────────────────────────────────────────────────────
echo "Step 1/3: Storing secrets..."

# Locate private key
KEY_FILE="${APP_PRIVATE_KEY_FILE:-}"
if [ -z "$KEY_FILE" ]; then
  # Search common locations
  for candidate in \
    "$HOME/dependabot-automerge-petry.pem" \
    "$HOME/dependabot-google-app-scripts"*.pem \
    "$HOME/.ssh/dependabot-automerge-petry.pem"; do
    if [ -f "$candidate" ]; then
      KEY_FILE="$candidate"
      break
    fi
  done
fi

if [ -z "$KEY_FILE" ] || [ ! -f "$KEY_FILE" ]; then
  echo "Error: Private key file not found."
  echo "Set APP_PRIVATE_KEY_FILE or place the .pem file in your home directory."
  exit 1
fi

echo "$APP_ID" | gh secret set APP_ID --repo "$REPO"
echo "  ✓ APP_ID"

gh secret set APP_PRIVATE_KEY --repo "$REPO" < "$KEY_FILE"
echo "  ✓ APP_PRIVATE_KEY (from $KEY_FILE)"

# ── Step 2: Add app to ruleset bypass list ────────────────────────────────────
echo ""
echo "Step 2/3: Updating ruleset bypass list..."

RULESET_ID=$(gh api "repos/$REPO/rulesets" -q ".[] | select(.name == \"$RULESET_NAME\") | .id" 2>/dev/null || echo "")

if [ -z "$RULESET_ID" ]; then
  echo "  ⏭ No '$RULESET_NAME' ruleset found — skipping"
else
  CURRENT=$(gh api "repos/$REPO/rulesets/$RULESET_ID")

  UPDATED=$(echo "$CURRENT" | python3 -c "
import sys, json
r = json.load(sys.stdin)
app_id = $APP_ID
bypass = r.get('bypass_actors', [])
if not any(a.get('actor_id') == app_id and a.get('actor_type') == 'Integration' for a in bypass):
    bypass.append({'actor_id': app_id, 'actor_type': 'Integration', 'bypass_mode': 'always'})
    print(json.dumps({
        'name': r['name'], 'target': r.get('target', 'branch'),
        'enforcement': r['enforcement'], 'conditions': r.get('conditions', {}),
        'rules': r.get('rules', []), 'bypass_actors': bypass
    }))
else:
    print('ALREADY_PRESENT')
")

  if [ "$UPDATED" = "ALREADY_PRESENT" ]; then
    echo "  ✓ App already in bypass list"
  else
    echo "$UPDATED" | gh api "repos/$REPO/rulesets/$RULESET_ID" --method PUT --input - >/dev/null
    echo "  ✓ App added to '$RULESET_NAME' bypass list"
  fi
fi

# ── Step 3: Ensure workflow exists ────────────────────────────────────────────
echo ""
echo "Step 3/3: Checking workflow..."

WORKFLOW_EXISTS=$(gh api "repos/$REPO/contents/.github/workflows/dependabot-automerge.yml" --jq '.name' 2>/dev/null || echo "")

if [ -n "$WORKFLOW_EXISTS" ]; then
  echo "  ✓ dependabot-automerge.yml already exists"
else
  echo "  ⚠ dependabot-automerge.yml not found in $REPO"
  echo "    Copy .github/workflows/dependabot-automerge.yml into the repo."
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "=== Setup complete for $REPO ==="
