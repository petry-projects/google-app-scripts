/**
 * GitHub REST API Sync Helper for Google Apps Script.
 * Performs atomic GET -> PUT markdown updates with 404 auto-initialization.
 */

var RULE6_PATTERNS = [
  [/\S \? \S/, "' ? ' between words (was an em dash or a · separator)"],
  [/\?\?/, "'??' (was a multi-codepoint emoji)"],
  [/[A-Za-z]\?[A-Za-z]/, "'?' inside a word (was a curly apostrophe)"],
  [/\uFFFD/, 'U+FFFD replacement character'],
]

/** Refuse to write an entry that already shows mojibake. */
function assertClean_(text, what) {
  if (!text) return
  for (var i = 0; i < RULE6_PATTERNS.length; i++) {
    if (RULE6_PATTERNS[i][0].test(text)) {
      throw new Error(
        'Rule 6: refusing to write ' + what + ' — ' + RULE6_PATTERNS[i][1]
      )
    }
  }
}

/** Refuse to write when a non-ASCII char in the source text became '?' on the way out. */
function assertNoAsciiReplacement_(source, rendered) {
  if (!source || !rendered) return
  if (rendered.indexOf('?') === -1) return
  var lost = []
  for (var i = 0; i < source.length; i++) {
    var c = source.charAt(i)
    if (
      c.charCodeAt(0) > 127 &&
      rendered.indexOf(c) === -1 &&
      lost.indexOf(c) === -1
    ) {
      lost.push(c)
    }
  }
  if (lost.length) {
    throw new Error(
      'Rule 6: refusing to write text that flattened non-ASCII to "?": ' +
        lost.join(' ') +
        ' — encode as UTF-8, not ASCII.'
    )
  }
}

function appendMarkdownEntryToGitHubRepo(
  filePath,
  entryContent,
  commitMessage
) {
  var config = getDriveIngesterConfig()
  if (!config.githubToken) {
    console.warn(
      '[gitHubSync] GITHUB_PAT missing in ScriptProperties. Skipping GitHub sync.'
    )
    return false
  }

  var repoOwner = 'don-petry'
  var repoName = 'self-private'
  var url =
    'https://api.github.com/repos/' +
    repoOwner +
    '/' +
    repoName +
    '/contents/' +
    filePath

  var headers = {
    Authorization: 'token ' + config.githubToken,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'GoogleAppsScript-DriveIngester',
  }

  try {
    var getResponse = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: headers,
      muteHttpExceptions: true,
    })

    var existingContent = ''
    var sha = null

    if (getResponse.getResponseCode() === 200) {
      var fileData = JSON.parse(getResponse.getContentText())
      sha = fileData.sha
      var decodedBytes = Utilities.base64Decode(fileData.content)
      existingContent = Utilities.newBlob(decodedBytes).getDataAsString()
    } else if (getResponse.getResponseCode() === 404) {
      existingContent =
        '---\ntitle: ' +
        filePath.split('/')[0] +
        '\ncreated: ' +
        Utilities.formatDate(new Date(), 'GMT', 'yyyy-MM-dd') +
        '\nnotebook: self-private\nsection: index\n---\n\n## Key References & Logs\n'
    } else {
      console.error(
        '[gitHubSync] GitHub GET HTTP ' +
          getResponse.getResponseCode() +
          ': ' +
          getResponse.getContentText()
      )
      return false
    }

    var updatedContent = existingContent + '\n' + entryContent

    // Rule 6 Guards: Refuse to commit if mojibake is detected in new entry or non-ASCII chars were flattened
    assertClean_(entryContent, 'new entry for ' + filePath)
    if (existingContent) {
      assertNoAsciiReplacement_(existingContent, updatedContent)
    }
    assertNoAsciiReplacement_(entryContent, updatedContent)

    var encodedContent = Utilities.base64Encode(
      Utilities.newBlob(updatedContent).getBytes()
    )

    var payload = {
      message: commitMessage,
      content: encodedContent,
    }
    if (sha) {
      payload.sha = sha
    }

    var putResponse = UrlFetchApp.fetch(url, {
      method: 'put',
      headers: headers,
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    })

    if (
      putResponse.getResponseCode() === 200 ||
      putResponse.getResponseCode() === 201
    ) {
      console.log(
        '[gitHubSync] Successfully committed Markdown update to GitHub: ' +
          filePath
      )
      return true
    } else {
      console.error(
        '[gitHubSync] GitHub PUT HTTP ' +
          putResponse.getResponseCode() +
          ': ' +
          putResponse.getContentText()
      )
    }
  } catch (err) {
    console.error('[gitHubSync] Exception syncing to GitHub: ' + err.message)
  }
  return false
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    appendMarkdownEntryToGitHubRepo: appendMarkdownEntryToGitHubRepo,
    assertClean_: assertClean_,
    assertNoAsciiReplacement_: assertNoAsciiReplacement_,
    RULE6_PATTERNS: RULE6_PATTERNS,
  }
}
