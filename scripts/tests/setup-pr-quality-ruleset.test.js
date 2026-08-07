const fs = require('fs')
const path = require('path')

// Extracts the JSON payload from the heredoc in setup-pr-quality-ruleset.sh.
// The script codifies the org-standard "pr-quality" ruleset; this test guards
// against configuration drift of the ruleset parameters (see issue #520).
function loadRulesetPayload() {
  const scriptPath = path.join(__dirname, '..', 'setup-pr-quality-ruleset.sh')
  const script = fs.readFileSync(scriptPath, 'utf8')
  const match = script.match(/<<'JSON'\n([\s\S]*?)\nJSON/)
  if (!match) {
    throw new Error('Could not locate the JSON heredoc payload in the script')
  }
  return JSON.parse(match[1])
}

describe('setup-pr-quality-ruleset.sh codified ruleset', () => {
  const payload = loadRulesetPayload()

  it('defines the pr-quality ruleset', () => {
    expect(payload.name).toBe('pr-quality')
  })

  it('requires last-push approval on the pull_request rule', () => {
    const pullRequestRule = payload.rules.find((r) => r.type === 'pull_request')
    expect(pullRequestRule).toBeDefined()
    expect(pullRequestRule.parameters.require_last_push_approval).toBe(true)
  })
})
