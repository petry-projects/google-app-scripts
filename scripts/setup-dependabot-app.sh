#!/usr/bin/env bash
# setup-dependabot-app.sh
#
# Creates a GitHub App for Dependabot auto-merge, installs it on the repo,
# stores credentials as repo secrets, and adds it to the ruleset bypass list.
#
# Prerequisites: gh (authenticated), python3, openssl, xdg-open or open
# Usage: bash scripts/setup-dependabot-app.sh

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
REPO="${REPO:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"
OWNER="${REPO%%/*}"
REPO_NAME="${REPO##*/}"
APP_NAME="${APP_NAME:-dependabot-merger-${REPO_NAME}}"
CALLBACK_PORT="${CALLBACK_PORT:-8976}"
RULESET_NAME="protect-branches"

echo "=== GitHub App Setup for Dependabot Auto-Merge ==="
echo "  Repo:     $REPO"
echo "  App name: $APP_NAME"
echo ""

# ── Preflight checks ─────────────────────────────────────────────────────────
for cmd in gh python3 openssl; do
  command -v "$cmd" >/dev/null || { echo "Error: $cmd is required but not found"; exit 1; }
done

gh auth status >/dev/null 2>&1 || { echo "Error: gh is not authenticated. Run: gh auth login"; exit 1; }

# Determine if owner is an org or user (affects manifest URL)
OWNER_TYPE=$(gh api "users/$OWNER" -q '.type' 2>/dev/null || echo "User")
if [ "$OWNER_TYPE" = "Organization" ]; then
  MANIFEST_URL="https://github.com/organizations/$OWNER/settings/apps/new"
else
  MANIFEST_URL="https://github.com/settings/apps/new"
fi

# ── Step 1: Create GitHub App via manifest flow ───────────────────────────────
echo "Step 1/4: Creating GitHub App via manifest flow..."

MANIFEST=$(python3 -c "
import json, sys
print(json.dumps({
    'name': '$APP_NAME',
    'url': 'https://github.com/$REPO',
    'hook_attributes': {'active': False},
    'redirect_url': 'http://localhost:$CALLBACK_PORT/callback',
    'public': False,
    'default_permissions': {
        'contents': 'write',
        'pull_requests': 'write'
    },
    'default_events': []
}))
")

# Base64-encode manifest so we can safely embed it in HTML without escaping issues
MANIFEST_B64=$(echo -n "$MANIFEST" | base64 | tr -d '\n')

TMPHTML=$(mktemp /tmp/gh-app-manifest-XXXX.html)
cat > "$TMPHTML" <<HTMLEOF
<!DOCTYPE html>
<html><body>
<p>Redirecting to GitHub to create the app...</p>
<form id="mf" method="post" action="$MANIFEST_URL">
  <input type="hidden" name="manifest" id="manifest-input">
</form>
<script>
  document.getElementById('manifest-input').value = atob('$MANIFEST_B64');
  document.getElementById('mf').submit();
</script>
</body></html>
HTMLEOF

# Start a one-shot HTTP server to catch the OAuth callback
CODEFILE=$(mktemp /tmp/gh-app-code-XXXX.txt)
python3 -c "
import http.server, urllib.parse, threading

class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        code = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get('code', [''])[0]
        with open('$CODEFILE', 'w') as f:
            f.write(code)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'<html><body><h2>App created! You can close this tab.</h2></body></html>')
        threading.Thread(target=self.server.shutdown).start()
    def log_message(self, *a): pass

http.server.HTTPServer(('127.0.0.1', $CALLBACK_PORT), H).serve_forever()
" &
SERVER_PID=$!

# Open browser
open_url() {
  for opener in xdg-open open garcon-url-handler; do
    if command -v "$opener" >/dev/null; then
      "$opener" "$1" 2>/dev/null &
      return
    fi
  done
  echo "  Please open this URL manually: $1"
}

open_url "file://$TMPHTML"
echo "  Browser opened. Click 'Create GitHub App' on GitHub."
echo "  Waiting for callback..."

wait "$SERVER_PID" 2>/dev/null || true
CODE=$(cat "$CODEFILE" 2>/dev/null || echo "")
rm -f "$TMPHTML" "$CODEFILE"

if [ -z "$CODE" ]; then
  echo "Error: No callback code received from GitHub."
  exit 1
fi

# Exchange code for app credentials
echo "  Exchanging code for credentials..."
CREDENTIALS=$(gh api "app-manifests/$CODE/conversions" --method POST)

APP_ID=$(echo "$CREDENTIALS" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
APP_SLUG=$(echo "$CREDENTIALS" | python3 -c "import sys,json; print(json.load(sys.stdin)['slug'])")
APP_PEM=$(echo "$CREDENTIALS" | python3 -c "import sys,json; print(json.load(sys.stdin)['pem'])")

echo "  Created: $APP_SLUG (ID: $APP_ID)"

# ── Step 2: Store secrets ─────────────────────────────────────────────────────
echo ""
echo "Step 2/4: Storing secrets..."

echo "$APP_ID" | gh secret set APP_ID --repo "$REPO"
echo "  ✓ APP_ID"

echo "$APP_PEM" | gh secret set APP_PRIVATE_KEY --repo "$REPO"
echo "  ✓ APP_PRIVATE_KEY"

# ── Step 3: Install app on repo ───────────────────────────────────────────────
echo ""
echo "Step 3/4: Installing app on repository..."

INSTALL_URL="https://github.com/apps/$APP_SLUG/installations/new"
open_url "$INSTALL_URL"
echo "  Browser opened. Select 'Only select repositories' → $REPO_NAME, then click Install."
echo ""
read -rp "  Press Enter after installing the app..."

# Verify installation by generating a JWT and querying the API
echo "  Verifying installation..."

JWT=$(python3 -c "
import time, base64, json, subprocess, sys

def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()

now = int(time.time())
header = b64url(json.dumps({'alg': 'RS256', 'typ': 'JWT'}).encode())
payload = b64url(json.dumps({'iat': now - 60, 'exp': now + 600, 'iss': '$APP_ID'}).encode())
signing_input = f'{header}.{payload}'.encode()

result = subprocess.run(
    ['openssl', 'dgst', '-sha256', '-sign', '/dev/stdin', '-binary'],
    input='''$APP_PEM'''.encode(),
    capture_output=True
)
signature = b64url(result.stdout)
print(f'{header}.{payload}.{signature}')
")

INSTALL_COUNT=$(python3 -c "
import urllib.request, json
req = urllib.request.Request(
    'https://api.github.com/app/installations',
    headers={
        'Authorization': 'Bearer $JWT',
        'Accept': 'application/vnd.github+json'
    }
)
data = json.loads(urllib.request.urlopen(req).read())
print(len(data))
" 2>/dev/null || echo "0")

if [ "$INSTALL_COUNT" -gt 0 ]; then
  echo "  ✓ App is installed ($INSTALL_COUNT installation(s))"
else
  echo "  ⚠ Could not verify installation. The app may need to be installed manually at:"
  echo "    $INSTALL_URL"
fi

# ── Step 4: Add app to ruleset bypass list ────────────────────────────────────
echo ""
echo "Step 4/4: Adding app to ruleset bypass list..."

# Find the ruleset ID by name
RULESET_ID=$(gh api "repos/$REPO/rulesets" -q ".[] | select(.name == \"$RULESET_NAME\") | .id" 2>/dev/null || echo "")

if [ -z "$RULESET_ID" ]; then
  echo "  ⚠ Ruleset '$RULESET_NAME' not found. You may need to add the app to the bypass list manually."
else
  # Get current ruleset, add bypass actor, and update
  CURRENT_RULESET=$(gh api "repos/$REPO/rulesets/$RULESET_ID")

  UPDATED_RULESET=$(echo "$CURRENT_RULESET" | python3 -c "
import sys, json

ruleset = json.load(sys.stdin)
app_id = int('$APP_ID')

# Check if already in bypass list
bypass = ruleset.get('bypass_actors', [])
if not any(a.get('actor_id') == app_id and a.get('actor_type') == 'Integration' for a in bypass):
    bypass.append({
        'actor_id': app_id,
        'actor_type': 'Integration',
        'bypass_mode': 'always'
    })

# Build update payload (only mutable fields)
update = {
    'name': ruleset['name'],
    'target': ruleset.get('target', 'branch'),
    'enforcement': ruleset['enforcement'],
    'conditions': ruleset.get('conditions', {}),
    'rules': ruleset.get('rules', []),
    'bypass_actors': bypass
}
print(json.dumps(update))
")

  echo "$UPDATED_RULESET" | gh api "repos/$REPO/rulesets/$RULESET_ID" \
    --method PUT --input - >/dev/null 2>&1

  echo "  ✓ App (ID: $APP_ID) added to '$RULESET_NAME' bypass list"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "=== Setup complete ==="
echo ""
echo "  App:     $APP_SLUG (ID: $APP_ID)"
echo "  Secrets: APP_ID, APP_PRIVATE_KEY"
echo "  Bypass:  added to $RULESET_NAME ruleset"
echo ""
echo "  The Dependabot auto-merge workflow will now use this app to merge PRs."
