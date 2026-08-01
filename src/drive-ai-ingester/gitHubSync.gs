/**
 * GitHub REST API Sync Helper for Google Apps Script.
 * Performs atomic GET -> PUT markdown updates with 404 auto-initialization.
 */

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
    var encodedContent = Utilities.base64Encode(updatedContent)

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
  }
}
