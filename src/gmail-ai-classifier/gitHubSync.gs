/**
 * Native Google Apps Script GitHub Sync Module
 * Calls GitHub REST API via UrlFetchApp to commit Markdown entries directly to self-private repo.
 */

var GITHUB_REPO_OWNER = 'don-petry'
var GITHUB_REPO_NAME = 'self-private'

/**
 * Appends a Progressive Disclosure entry to a target markdown file in self-private via GitHub REST API.
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
    // 1. Fetch existing file content & SHA from GitHub API
    var getOptions = {
      method: 'get',
      headers: headers,
      muteHttpExceptions: true,
    }
    var res = UrlFetchApp.fetch(url, getOptions)
    if (res.getResponseCode() !== 200) {
      console.error(
        '[gitHubSync] Error fetching file from GitHub:',
        filePath,
        res.getContentText()
      )
      return false
    }

    var fileData = JSON.parse(res.getContentText())
    var sha = fileData.sha
    var rawContent = Utilities.newBlob(
      Utilities.base64Decode(fileData.content)
    ).getDataAsString()

    // 2. Idempotency Check: Skip if entry already present
    if (
      rawContent.indexOf(commitMessage) !== -1 ||
      rawContent.indexOf(entryMd.trim()) !== -1
    ) {
      console.log(
        '[gitHubSync] Idempotent Skip: Entry already exists in',
        filePath
      )
      return true
    }

    // 3. Append Markdown Entry
    var updatedContent = rawContent + '\n' + entryMd
    var base64Updated = Utilities.base64Encode(updatedContent)

    // 4. Commit updated file back to GitHub main branch
    var putPayload = {
      message:
        commitMessage ||
        'feat(automation): append ingested document entry via Google Apps Script',
      content: base64Updated,
      sha: sha,
      branch: 'main',
    }

    var putOptions = {
      method: 'put',
      headers: headers,
      contentType: 'application/json',
      payload: JSON.stringify(putPayload),
      muteHttpExceptions: true,
    }

    var putRes = UrlFetchApp.fetch(url, putOptions)
    if (putRes.getResponseCode() === 200 || putRes.getResponseCode() === 201) {
      console.log(
        '[gitHubSync] Successfully committed markdown entry to GitHub:',
        filePath
      )
      return true
    } else {
      console.error(
        '[gitHubSync] Error committing to GitHub:',
        putRes.getContentText()
      )
      return false
    }
  } catch (e) {
    console.error('[gitHubSync] Exception calling GitHub API:', e.message)
    return false
  }
}
