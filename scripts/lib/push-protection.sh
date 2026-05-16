# shellcheck shell=bash
# scripts/lib/push-protection.sh — Shared push-protection logic
#
# Sourceable Bash library that implements the apply + check functions for
# the petry-projects Push Protection Standard:
#
#   standards/push-protection.md
#
# Both scripts/apply-repo-settings.sh and scripts/compliance-audit.sh source
# this file so the org-required `security_and_analysis` settings, audit
# checks, and remediation logic live in exactly one place. Any future change
# to the standard's required state happens here, not in two parallel copies.
#
# ----------------------------------------------------------------------------
# Caller contract
# ----------------------------------------------------------------------------
# This library is `set -euo pipefail`-safe and designed to be sourced by a
# parent script. It does NOT call `set` itself.
#
# Required by ALL functions:
#   - $ORG          — GitHub org slug (e.g. "petry-projects")
#
# Required by `pp_apply_*` functions (used by apply-repo-settings.sh):
#   - info(), ok(), err(), skip()  — log helpers (string arg)
#   - $DRY_RUN                      — "true" / "false"
#   - `gh` CLI on PATH, GH_TOKEN with admin:repo scope
#
# Required by `pp_check_*` functions (used by compliance-audit.sh):
#   - gh_api()      — wrapper around `gh api` with retry
#   - add_finding() — add_finding <repo> <category> <check> <severity> <detail> [<standard_ref>]
#   - `gh` CLI on PATH, GH_TOKEN with read:org + repo scope
#
# Functions are namespaced with the `pp_` prefix to avoid colliding with
# caller helpers.

# ---------------------------------------------------------------------------
# Required state — single source of truth
# ---------------------------------------------------------------------------
# Each entry: "api_key:expected_value:severity:human_detail"
# Severity is one of: error, warning. The audit and the apply script both
# read from this list, so adding a new flag here automatically extends both.
PP_REQUIRED_SA_SETTINGS=(
  "secret_scanning:enabled:error:Secret scanning must be enabled"
  "secret_scanning_push_protection:enabled:error:Secret scanning push protection must be enabled"
  "secret_scanning_ai_detection:enabled:warning:Secret scanning AI detection should be enabled"
  "secret_scanning_non_provider_patterns:enabled:warning:Secret scanning non-provider patterns should be enabled"
  "dependabot_security_updates:enabled:warning:Dependabot security updates should be enabled"
)

# Minimum entries that every repo's .gitignore MUST contain. Every repo
# starting from the org baseline at /.gitignore satisfies these by default.
PP_REQUIRED_GITIGNORE_PATTERNS=(
  ".env"
  "*.pem"
  "*.key"
)

# Number of days back the bypass-recency check looks for unjustified
# push-protection bypasses.
PP_BYPASS_LOOKBACK_DAYS="${PP_BYPASS_LOOKBACK_DAYS:-30}"

# Standard reference path used by every check finding.
PP_STANDARD_REF="standards/push-protection.md"

# ---------------------------------------------------------------------------
# Apply: security_and_analysis (used by apply-repo-settings.sh)
# ---------------------------------------------------------------------------
# Idempotent: fetches current state, only PATCHes when at least one flag
# differs from the required value. Honors $DRY_RUN.
pp_apply_security_and_analysis() {
  local repo="$1"
  info "Applying push-protection security_and_analysis to $ORG/$repo ..."

  local current
  current=$(gh api "repos/$ORG/$repo" --jq '.security_and_analysis // {}' 2>/dev/null || echo "{}")

  if [ "$current" = "{}" ] || [ -z "$current" ]; then
    err "Could not fetch security_and_analysis for $ORG/$repo — check token has admin scope"
    return 1
  fi

  local needs_patch=false
  local payload="{}"

  local entry key expected actual
  for entry in "${PP_REQUIRED_SA_SETTINGS[@]}"; do
    IFS=':' read -r key expected _ _ <<< "$entry"
    actual=$(echo "$current" | jq -r ".\"$key\".status // \"null\"")

    if [ "$actual" != "$expected" ]; then
      info "  $key: $actual → $expected"
      needs_patch=true
      payload=$(echo "$payload" | jq --arg k "$key" --arg v "$expected" '. + {($k): {status: $v}}')
    else
      ok "  $key: already $actual"
    fi
  done

  if [ "$needs_patch" = false ]; then
    ok "$ORG/$repo security_and_analysis already fully compliant — no changes needed"
    return 0
  fi

  if [ "$DRY_RUN" = "true" ]; then
    skip "DRY_RUN=true — skipping security_and_analysis PATCH for $ORG/$repo"
    return 0
  fi

  # Wrap the per-key payload in a top-level security_and_analysis object and
  # PATCH it via stdin (gh api -F doesn't accept nested JSON).
  local full_payload
  full_payload=$(echo "$payload" | jq '{security_and_analysis: .}')

  if echo "$full_payload" | gh api -X PATCH "repos/$ORG/$repo" --input - > /dev/null 2>&1; then
    ok "$ORG/$repo security_and_analysis updated successfully"
  else
    err "Failed to PATCH security_and_analysis for $ORG/$repo — check admin scope and that the org plan supports these features"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Check: security_and_analysis (used by compliance-audit.sh)
# ---------------------------------------------------------------------------
# Reads the same PP_REQUIRED_SA_SETTINGS list the apply function uses, so
# the audit can never drift from what apply enforces.
pp_check_security_and_analysis() {
  local repo="$1"

  local sa
  sa=$(gh_api "repos/$ORG/$repo" --jq '.security_and_analysis // {}' 2>/dev/null || echo "{}")

  if [ "$sa" = "{}" ] || [ -z "$sa" ]; then
    add_finding "$repo" "push-protection" "security_and_analysis_unavailable" "warning" \
      "Could not fetch security_and_analysis — token may lack admin scope, or the repo's plan does not expose these settings" \
      "$PP_STANDARD_REF#required-repo-level-settings"
    return
  fi

  local entry key expected severity detail actual
  for entry in "${PP_REQUIRED_SA_SETTINGS[@]}"; do
    IFS=':' read -r key expected severity detail <<< "$entry"
    actual=$(echo "$sa" | jq -r ".\"$key\".status // \"null\"")
    if [ "$actual" != "$expected" ]; then
      add_finding "$repo" "push-protection" "$key" "$severity" \
        "$detail (current: \`$actual\`, expected: \`$expected\`)" \
        "$PP_STANDARD_REF#required-repo-level-settings"
    fi
  done
}

# ---------------------------------------------------------------------------
# Check: open secret-scanning alerts
# ---------------------------------------------------------------------------
# Any open alert is a real leaked credential that needs rotation. This is an
# `error` finding — open alerts MUST be triaged within the SLA in the
# incident-response section of the standard.
pp_check_open_secret_alerts() {
  local repo="$1"

  local alerts
  alerts=$(gh_api "repos/$ORG/$repo/secret-scanning/alerts?state=open&per_page=100" 2>/dev/null || echo "[]")

  # 404 / disabled secret scanning produces a non-array response; coerce to []
  if ! echo "$alerts" | jq -e 'type == "array"' >/dev/null 2>&1; then
    return
  fi

  local count
  count=$(echo "$alerts" | jq 'length')

  if [ "$count" -gt 0 ]; then
    add_finding "$repo" "push-protection" "open_secret_alerts" "error" \
      "$count open secret-scanning alert(s) — rotate the leaked credentials before resolving" \
      "$PP_STANDARD_REF#incident-response"
  fi
}

# ---------------------------------------------------------------------------
# Check: ci.yml contains a secret-scan job using gitleaks
# ---------------------------------------------------------------------------
pp_check_secret_scan_ci_job() {
  local repo="$1"

  local ci_b64
  ci_b64=$(gh_api "repos/$ORG/$repo/contents/.github/workflows/ci.yml" --jq '.content // ""' 2>/dev/null || echo "")

  if [ -z "$ci_b64" ]; then
    add_finding "$repo" "push-protection" "secret_scan_ci_job_present" "error" \
      "No \`.github/workflows/ci.yml\` found — cannot verify the required \`secret-scan\` gitleaks job" \
      "$PP_STANDARD_REF#layer-3--ci-secret-scanning-secondary-defense"
    return
  fi

  local ci_content
  # GitHub returns content base64-encoded, line-wrapped at 60 chars
  ci_content=$(echo "$ci_b64" | tr -d '\n ' | base64 -d 2>/dev/null || echo "")

  if [ -z "$ci_content" ]; then
    return
  fi

  # Match actual action references, not bare mentions in comments or docs.
  if ! echo "$ci_content" | grep -qE 'uses:[[:space:]]*(gitleaks/gitleaks-action|zricethezav/gitleaks-action)@'; then
    add_finding "$repo" "push-protection" "secret_scan_ci_job_present" "error" \
      "\`ci.yml\` does not contain a job using \`gitleaks\` — add the secret-scan job from the standard" \
      "$PP_STANDARD_REF#required-ci-job"
  fi
}

# ---------------------------------------------------------------------------
# Check: .gitignore contains the baseline secret-protection entries
# ---------------------------------------------------------------------------
pp_check_gitignore_secrets_block() {
  local repo="$1"

  local gi_b64
  gi_b64=$(gh_api "repos/$ORG/$repo/contents/.gitignore" --jq '.content // ""' 2>/dev/null || echo "")

  if [ -z "$gi_b64" ]; then
    add_finding "$repo" "push-protection" "gitignore_secrets_block" "warning" \
      "No \`.gitignore\` at repo root — start from the org baseline at /.gitignore" \
      "$PP_STANDARD_REF#required-gitignore-entries"
    return
  fi

  local gi_content
  gi_content=$(echo "$gi_b64" | tr -d '\n ' | base64 -d 2>/dev/null || echo "")

  if [ -z "$gi_content" ]; then
    return
  fi

  local missing=()
  local pattern
  for pattern in "${PP_REQUIRED_GITIGNORE_PATTERNS[@]}"; do
    # Use fixed-string match anchored to a line; ignore lines that start with `!`
    # so a negation can't satisfy the requirement for the broad pattern.
    if ! echo "$gi_content" | grep -vE '^[[:space:]]*!' | grep -qxF "$pattern"; then
      missing+=("$pattern")
    fi
  done

  if [ ${#missing[@]} -gt 0 ]; then
    add_finding "$repo" "push-protection" "gitignore_secrets_block" "warning" \
      "\`.gitignore\` is missing baseline secret patterns: $(IFS=', '; echo "${missing[*]}") — copy the org baseline at /.gitignore" \
      "$PP_STANDARD_REF#required-gitignore-entries"
  fi
}

# ---------------------------------------------------------------------------
# Check: recent push-protection bypasses
# ---------------------------------------------------------------------------
# Queries the secret-scanning alerts endpoint and looks for any alert that
# was bypassed via push protection within the lookback window. We can't tell
# from the alert payload whether a bypass had a documented justification, so
# this fires as a `warning` and the human reviewer must verify.
pp_check_push_protection_bypasses() {
  local repo="$1"

  local alerts
  alerts=$(gh_api "repos/$ORG/$repo/secret-scanning/alerts?per_page=100" 2>/dev/null || echo "[]")

  if ! echo "$alerts" | jq -e 'type == "array"' >/dev/null 2>&1; then
    return
  fi

  # Cutoff: now - PP_BYPASS_LOOKBACK_DAYS, in ISO-8601
  local cutoff
  if date -u -d "$PP_BYPASS_LOOKBACK_DAYS days ago" "+%Y-%m-%dT%H:%M:%SZ" >/dev/null 2>&1; then
    # GNU date (Linux / GitHub Actions runners)
    cutoff=$(date -u -d "$PP_BYPASS_LOOKBACK_DAYS days ago" "+%Y-%m-%dT%H:%M:%SZ")
  else
    # BSD date (macOS) fallback
    cutoff=$(date -u -v-"${PP_BYPASS_LOOKBACK_DAYS}d" "+%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "")
  fi

  if [ -z "$cutoff" ]; then
    return
  fi

  local recent_bypasses
  recent_bypasses=$(echo "$alerts" | jq --arg cutoff "$cutoff" '
    [.[] | select(
      .push_protection_bypassed == true and
      (.push_protection_bypassed_at != null) and
      (.push_protection_bypassed_at >= $cutoff)
    )] | length
  ' 2>/dev/null || echo "0")

  if [ "$recent_bypasses" -gt 0 ]; then
    add_finding "$repo" "push-protection" "push_protection_bypasses_recent" "warning" \
      "$recent_bypasses push-protection bypass(es) in the last $PP_BYPASS_LOOKBACK_DAYS days — verify each had a documented justification" \
      "$PP_STANDARD_REF#bypass-policy"
  fi
}

# ---------------------------------------------------------------------------
# Convenience: run every push-protection check for one repo
# ---------------------------------------------------------------------------
# Callers may call individual checks if they want to interleave with other
# work, but the audit's per-repo loop just calls this single entry point.
pp_run_all_checks() {
  local repo="$1"
  pp_check_security_and_analysis "$repo"
  pp_check_open_secret_alerts "$repo"
  pp_check_secret_scan_ci_job "$repo"
  pp_check_gitignore_secrets_block "$repo"
  pp_check_push_protection_bypasses "$repo"
}
