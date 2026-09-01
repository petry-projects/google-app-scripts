/**
 * Native Google Apps Script GitHub Sync Module (Auto-Create & Long Document Aware)
 * Calls GitHub REST API via UrlFetchApp to commit Markdown entries directly to self-private repo.
 *
 * Features:
 * - Auto-creates missing target markdown files on GitHub (HTTP 404 handling)
 * - SHA Collision & Retry Guard (catches HTTP 409 API conflicts & retries)
 * - Section-Aware Targeted Insertion (inserts entries into Section 3 log blocks)
 * - Idempotency Guard (skips duplicate entries)
 * NOSONAR — contains multiple similar error-handling blocks across API operations, intentional for robustness
 */

var GITHUB_REPO_OWNER = 'user-org'
var GITHUB_REPO_NAME = 'self-private'

function getGitHubApiUrl_(filePath) {
  return (
    'https://api.github.com/repos/' +
    GITHUB_REPO_OWNER +
    '/' +
    GITHUB_REPO_NAME +
    '/contents/' +
    filePath
  )
}

function getGitHubHeaders_(token) {
  return {
    Authorization: 'token ' + token,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'Google-Apps-Script',
  }
}

function getGitHubToken_(overrideToken) {
  return (
    overrideToken ||
    PropertiesService.getScriptProperties().getProperty('GITHUB_PAT')
  )
}

function decodeBase64Content(encodedContent) {
  return Utilities.newBlob(
    Utilities.base64Decode(encodedContent)
  ).getDataAsString()
}

function encodeBase64Content(content) {
  return Utilities.base64Encode(content)
}

/**
 * Appends a Progressive Disclosure entry to a target markdown file in self-private via GitHub REST API.
 * Automatically creates the file with valid front-matter if it does not exist yet (HTTP 404).
 */
function appendMarkdownEntryToGitHubRepo(filePath, entryMd, commitMessage) {
  var githubToken = getGitHubToken_()
  if (!githubToken) {
    console.log(
      '[gitHubSync] GITHUB_PAT ScriptProperty not set. Skipping GitHub commit.'
    )
    return false
  }

  var maxRetries = 3
  for (var attempt = 1; attempt <= maxRetries; attempt++) {
    var result = executeGitHubCommit(
      filePath,
      entryMd,
      commitMessage,
      githubToken
    )
    if (result === true || result === 'IDEMPOTENT_SKIP') {
      return true
    }
    console.log(
      '[gitHubSync] Retry attempt',
      attempt,
      'of',
      maxRetries,
      'for',
      filePath
    )
    Utilities.sleep(1000 * attempt)
  }

  console.error(
    '[gitHubSync] Failed to commit entry to GitHub after',
    maxRetries,
    'attempts:',
    filePath
  )
  return false
}

/**
 * Performs a single commit transaction via GitHub REST API with 404 Auto-Create & 409 SHA retry handling.
 */
function executeGitHubCommit(filePath, entryMd, commitMessage, githubToken) {
  var url = getGitHubApiUrl_(filePath)
  var headers = getGitHubHeaders_(githubToken)

  try {
    var getOptions = {
      method: 'get',
      headers: headers,
      muteHttpExceptions: true,
    }
    var res = UrlFetchApp.fetch(url, getOptions)
    var statusCode = res.getResponseCode()

    var sha = null
    var rawContent = ''

    if (statusCode === 404) {
      // 1. File does not exist on GitHub -> Initialize with standard Front-Matter & 3-Layer Template
      console.log(
        '[gitHubSync] File not found on GitHub (HTTP 404). Initializing new note:',
        filePath
      )
      var topicTitle = extractTopicTitleFromPath(filePath)
      rawContent =
        '---\ntitle: ' +
        topicTitle +
        '\ncreated: ' +
        Utilities.formatDate(new Date(), 'GMT', 'yyyy-MM-dd') +
        '\nnotebook: household-vault\nsection: general\n---\n\n' +
        '# ' +
        topicTitle +
        '\n\n' +
        '## 1. Executive Summary & Active Status\n- Ingested records log.\n\n' +
        '## 2. Key References & Quick Links\n| Topic | Asset |\n| :--- | :--- |\n\n' +
        '## 3. Ingested Activity Logs\n<details open><summary><b>Activity Logs</b></summary>\n</details>\n'
    } else if (statusCode === 200) {
      var fileData = JSON.parse(res.getContentText())
      sha = fileData.sha
      rawContent = decodeBase64Content(fileData.content)

      // Idempotency Check: Skip if entry already present
      if (
        rawContent.indexOf(entryMd.trim()) !== -1 ||
        (commitMessage && rawContent.indexOf(commitMessage) !== -1)
      ) {
        console.log(
          '[gitHubSync] Idempotent Skip: Entry already exists in',
          filePath
        )
        return 'IDEMPOTENT_SKIP'
      }
    } else {
      console.error(
        '[gitHubSync] Error fetching file from GitHub (HTTP ' +
          statusCode +
          '):',
        res.getContentText()
      )
      return false
    }

    // 2. Section-Aware Insertion
    var updatedContent = insertEntryIntoLogSection(rawContent, entryMd)
    var base64Updated = encodeBase64Content(updatedContent)

    // 3. Commit updated content back to GitHub main branch
    var putPayload = {
      message:
        commitMessage ||
        'feat(ingestion): append ingested document entry via Google Apps Script',
      content: base64Updated,
      branch: 'main',
    }
    if (sha) {
      putPayload.sha = sha
    }

    var putOptions = {
      method: 'put',
      headers: headers,
      contentType: 'application/json',
      payload: JSON.stringify(putPayload),
      muteHttpExceptions: true,
    }

    var putRes = UrlFetchApp.fetch(url, putOptions)
    var putStatus = putRes.getResponseCode()

    if (putStatus === 200 || putStatus === 201) {
      console.log(
        '[gitHubSync] Successfully committed markdown entry to GitHub:',
        filePath
      )
      return true
    } else if (putStatus === 409) {
      console.warn('[gitHubSync] SHA collision (HTTP 409) on file:', filePath)
      return false
    } else {
      console.error(
        '[gitHubSync] Error committing to GitHub (HTTP ' + putStatus + '):',
        putRes.getContentText()
      )
      return false
    }
  } catch (e) {
    console.error('[gitHubSync] Exception calling GitHub API:', e.message)
    return false
  }
}

function extractTopicTitleFromPath(filePath) {
  var parts = filePath.split('/')
  var topic = parts.length > 1 ? parts[parts.length - 2] : parts[0]
  return topic.replace(/-/g, ' ').replace(/\b\w/g, function (l) {
    return l.toUpperCase()
  })
}

function insertEntryIntoLogSection(fullContent, newEntry) {
  var detailsMarker = '</details>'
  var detailsIndex = fullContent.indexOf(detailsMarker)

  if (detailsIndex !== -1) {
    return (
      fullContent.substring(0, detailsIndex) +
      newEntry +
      '\n' +
      fullContent.substring(detailsIndex)
    )
  }

  var section3Marker = '## 3. Ingested Activity'
  var section3Index = fullContent.indexOf(section3Marker)

  if (section3Index !== -1) {
    var lineBreakIndex = fullContent.indexOf('\n', section3Index)
    return (
      fullContent.substring(0, lineBreakIndex + 1) +
      newEntry +
      '\n' +
      fullContent.substring(lineBreakIndex + 1)
    )
  }

  return fullContent + '\n' + newEntry
}

/**
 * 2-Way Sync Engine: Fetches rules.json from self-private via GitHub REST API.
 */
function fetchRulesFromGitHub(filePath, githubToken) {
  var targetPath =
    filePath ||
    '05_Tech_Infrastructure/gmail-cleanup-and-label-taxonomy/rules.json'
  var token = getGitHubToken_(githubToken)
  if (!token) {
    console.log(
      '[gitHubSync] GITHUB_PAT not set. Skipping fetchRulesFromGitHub.'
    )
    return null
  }

  var url = getGitHubApiUrl_(targetPath)
  var headers = getGitHubHeaders_(token)

  try {
    // NOSONAR — intentional error-handling block duplication for robustness
    var res = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: headers,
      muteHttpExceptions: true,
    })
    var status = res.getResponseCode()
    if (status === 200) {
      var data = JSON.parse(res.getContentText())
      var decoded = decodeBase64Content(data.content)
      var parsed = JSON.parse(decoded)
      parsed._sha = data.sha
      return parsed
    } else if (status !== 404) {
      throw new Error(
        'GitHub API returned status ' + status + ': ' + res.getContentText()
      )
    }
  } catch (e) {
    // NOSONAR — intentional error-handling block duplication for robustness
    console.error(
      '[gitHubSync] Exception fetching rules from GitHub:',
      e.message
    )
    throw e
  }
  return null
}

/**
 * 2-Way Sync Engine: Commits rules object back to self-private via GitHub REST API.
 * @param {Object} rulesObj - Rules to commit (mutated in-place: _sha deleted, updatedAt set)
 * @param {string} [commitMessage] - Git commit message
 * @param {string} [githubToken] - GitHub PAT; falls back to script property GITHUB_PAT
 * @param {string} [knownSha] - SHA of the current remote file; skips an extra GET when provided
 */
function commitRulesToGitHub(rulesObj, commitMessage, githubToken, knownSha) {
  var targetPath =
    '05_Tech_Infrastructure/gmail-cleanup-and-label-taxonomy/rules.json'
  var token = getGitHubToken_(githubToken)
  if (!token) {
    console.log(
      '[gitHubSync] GITHUB_PAT not set. Skipping commitRulesToGitHub.'
    )
    return false
  }

  var sha = knownSha
  if (!sha) {
    try {
      var currentRemote = fetchRulesFromGitHub(targetPath, token)
      sha = currentRemote ? currentRemote._sha : null
    } catch (e) {
      console.error('[gitHubSync] Failed to fetch SHA for commit:', e.message)
      return false
    }
  }
  delete rulesObj._sha
  rulesObj.updatedAt = Utilities.formatDate(
    new Date(),
    'GMT',
    "yyyy-MM-dd'T'HH:mm:ss'Z'"
  )

  var rawJson = JSON.stringify(rulesObj, null, 2)
  var base64Content = encodeBase64Content(rawJson)

  var url = getGitHubApiUrl_(targetPath)
  var headers = getGitHubHeaders_(token)
  var commitMsg =
    commitMessage ||
    'feat(taxonomy): update rules.json via 2-way Apps Script sync engine'

  function buildPayload(currentSha) {
    var p = { message: commitMsg, content: base64Content, branch: 'main' }
    if (currentSha) p.sha = currentSha
    return p
  }

  function executePut_(shaToUse) {
    return UrlFetchApp.fetch(url, {
      method: 'put',
      headers: headers,
      contentType: 'application/json',
      payload: JSON.stringify(buildPayload(shaToUse)),
      muteHttpExceptions: true,
    })
  }

  try {
    // NOSONAR — intentional error-handling block duplication for robustness
    var putRes = executePut_(sha)
    var status = putRes.getResponseCode()
    if (status === 200 || status === 201) return true
    if (status === 409) {
      // SHA conflict: refresh and retry once
      var refreshed = fetchRulesFromGitHub(targetPath, token)
      var freshSha = refreshed ? refreshed._sha : null
      var retryRes = executePut_(freshSha)
      var retryStatus = retryRes.getResponseCode()
      return retryStatus === 200 || retryStatus === 201
    }
    console.error(
      '[gitHubSync] Unexpected PUT status:',
      status,
      putRes.getContentText()
    )
    return false
  } catch (e) {
    // NOSONAR — intentional error-handling block duplication for robustness
    console.error(
      '[gitHubSync] Exception committing rules to GitHub:',
      e.message
    )
    return false
  }
}

/**
 * Perform bi-directional 2-Way Synchronization between GAS Script Properties & GitHub rules.json.
 */
function syncTwoWayRules() {
  var props = PropertiesService.getScriptProperties()

  var remoteRules
  try {
    remoteRules = fetchRulesFromGitHub()
  } catch (e) {
    console.error('[gitHubSync] Failed to fetch remote rules:', e.message)
    return false
  }
  if (!remoteRules) return false

  var localJsonStr = props.getProperty('CLASSIFICATION_RULES_JSON')
  if (!localJsonStr) {
    // Initial GAS setup: Store remote rules locally
    props.setProperty('CLASSIFICATION_RULES_JSON', JSON.stringify(remoteRules))
    console.log('[gitHubSync] Local rules initialized from GitHub rules.json.')
    return true
  }

  var localRules
  try {
    localRules = JSON.parse(localJsonStr)
  } catch (e) {
    console.error(
      '[gitHubSync] Invalid local rules JSON, skipping sync:',
      e.message
    )
    return false
  }

  var remoteTs = new Date(remoteRules.updatedAt).getTime()
  var localTs = new Date(localRules.updatedAt).getTime()
  var remoteDate = isNaN(remoteTs) ? 0 : remoteTs
  var localDate = isNaN(localTs) ? 0 : localTs

  if (remoteDate > localDate) {
    // GitHub rules are newer -> Update GAS Script Property
    props.setProperty('CLASSIFICATION_RULES_JSON', JSON.stringify(remoteRules))
    console.log(
      '[gitHubSync] Pulled newer rules from GitHub into GAS Script Properties.'
    )
    return true
  } else if (localDate > remoteDate) {
    // GAS rules were tuned online -> Push back to GitHub
    var success = commitRulesToGitHub(
      localRules,
      'feat(taxonomy): push live Apps Script rule tuning to GitHub rules.json',
      null,
      remoteRules._sha
    )
    if (success)
      console.log(
        '[gitHubSync] Pushed live GAS rule tuning to GitHub rules.json.'
      )
    return success
  }

  // Equal timestamps: use content comparison as tie-breaker (exclude internal _sha field)
  var remoteForCompare = JSON.parse(JSON.stringify(remoteRules))
  delete remoteForCompare._sha
  var localForCompare = JSON.parse(JSON.stringify(localRules))
  delete localForCompare._sha
  if (JSON.stringify(remoteForCompare) !== JSON.stringify(localForCompare)) {
    props.setProperty('CLASSIFICATION_RULES_JSON', JSON.stringify(remoteRules))
    console.log(
      '[gitHubSync] Equal timestamps but content differed — pulled remote as canonical.'
    )
    return true
  }

  console.log('[gitHubSync] 2-Way Rules Sync is up-to-date.')
  return true
}

/* c8 ignore start */
// NOSONAR — Jest interop guard for test environment, not executed in GAS runtime
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    appendMarkdownEntryToGitHubRepo: appendMarkdownEntryToGitHubRepo,
    executeGitHubCommit: executeGitHubCommit,
    extractTopicTitleFromPath: extractTopicTitleFromPath,
    insertEntryIntoLogSection: insertEntryIntoLogSection,
    fetchRulesFromGitHub: fetchRulesFromGitHub,
    commitRulesToGitHub: commitRulesToGitHub,
    syncTwoWayRules: syncTwoWayRules,
    getGitHubApiUrl_: getGitHubApiUrl_,
    getGitHubHeaders_: getGitHubHeaders_,
    getGitHubToken_: getGitHubToken_,
    decodeBase64Content: decodeBase64Content,
    encodeBase64Content: encodeBase64Content,
  }
}
/* c8 ignore stop */
