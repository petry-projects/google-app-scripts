/**
 * Native Google Apps Script GitHub Sync Module (Auto-Create & Long Document Aware)
 * Calls GitHub REST API via UrlFetchApp to commit Markdown entries directly to self-private repo.
 *
 * Features:
 * - Auto-creates missing target markdown files on GitHub (HTTP 404 handling)
 * - SHA Collision & Retry Guard (catches HTTP 409 API conflicts & retries)
 * - Section-Aware Targeted Insertion (inserts entries into Section 3 log blocks)
 * - Idempotency Guard (skips duplicate entries)
 */

var GITHUB_REPO_OWNER = 'don-petry'
var GITHUB_REPO_NAME = 'self-private'

/**
 * Appends a Progressive Disclosure entry to a target markdown file in self-private via GitHub REST API.
 * Automatically creates the file with valid front-matter if it does not exist yet (HTTP 404).
 */
function appendMarkdownEntryToGitHubRepo(filePath, entryMd, commitMessage) {
  var githubToken =
    PropertiesService.getScriptProperties().getProperty('GITHUB_PAT')
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
  var url =
    'https://api.github.com/repos/' +
    GITHUB_REPO_OWNER +
    '/' +
    GITHUB_REPO_NAME +
    '/contents/' +
    filePath
  var headers = {
    Authorization: 'token ' + githubToken,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'Google-Apps-Script',
  }

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
        '\nnotebook: petry-household\nsection: general\n---\n\n' +
        '# ' +
        topicTitle +
        '\n\n' +
        '## 1. Executive Summary & Active Status\n- Ingested records log.\n\n' +
        '## 2. Key References & Quick Links\n| Topic | Asset |\n| :--- | :--- |\n\n' +
        '## 3. Ingested Activity Logs\n<details open><summary><b>Activity Logs</b></summary>\n</details>\n'
    } else if (statusCode === 200) {
      var fileData = JSON.parse(res.getContentText())
      sha = fileData.sha
      rawContent = Utilities.newBlob(
        Utilities.base64Decode(fileData.content)
      ).getDataAsString()

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
    var base64Updated = Utilities.base64Encode(updatedContent)

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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    appendMarkdownEntryToGitHubRepo: appendMarkdownEntryToGitHubRepo,
    executeGitHubCommit: executeGitHubCommit,
    extractTopicTitleFromPath: extractTopicTitleFromPath,
    insertEntryIntoLogSection: insertEntryIntoLogSection,
  }
}
