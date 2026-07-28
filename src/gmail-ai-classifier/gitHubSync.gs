/**
 * Native Google Apps Script GitHub Sync Module (Optimized for Long Documents)
 * Calls GitHub REST API via UrlFetchApp to commit Markdown entries directly to self-private repo.
 * 
 * Features:
 * - SHA Collision & Retry Guard (catches HTTP 409 API conflicts & retries)
 * - Section-Aware Targeted Insertion (inserts entries into Section 3 log blocks)
 * - Idempotency Guard (skips duplicate entries)
 * - Log Partitioning Support (routes to logs/YYYY.md when master index exceeds size limits)
 */

var GITHUB_REPO_OWNER = 'don-petry'
var GITHUB_REPO_NAME = 'self-private'

/**
 * Appends a Progressive Disclosure entry to a target markdown file in self-private via GitHub REST API.
 * Handles SHA collision retries for safe concurrency.
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

<<<<<<< HEAD
  var url =
    'https://api.github.com/repos/' +
    GITHUB_REPO_OWNER +
    '/' +
    GITHUB_REPO_NAME +
    '/contents/' +
    filePath
=======
  var maxRetries = 3;
  for (var attempt = 1; attempt <= maxRetries; attempt++) {
    var success = executeGitHubCommit(filePath, entryMd, commitMessage, githubToken);
    if (success === true || success === 'IDEMPOTENT_SKIP') {
      return true;
    }
    console.log('[gitHubSync] Retry attempt', attempt, 'of', maxRetries, 'for', filePath);
    Utilities.sleep(1000 * attempt);
  }
  
  console.error('[gitHubSync] Failed to commit entry to GitHub after', maxRetries, 'attempts:', filePath);
  return false;
}

/**
 * Performs a single commit transaction via GitHub REST API with SHA collision detection.
 */
function executeGitHubCommit(filePath, entryMd, commitMessage, githubToken) {
  var url = 'https://api.github.com/repos/' + GITHUB_REPO_OWNER + '/' + GITHUB_REPO_NAME + '/contents/' + filePath;
>>>>>>> 22261d6 (feat: enhance gitHubSync with targeted insertion and 409 SHA collision retries)
  var headers = {
    Authorization: 'token ' + githubToken,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'Google-Apps-Script',
  }

  try {
<<<<<<< HEAD
    // 1. Fetch existing file content & SHA from GitHub API
    var getOptions = {
      method: 'get',
      headers: headers,
      muteHttpExceptions: true,
    }
    var res = UrlFetchApp.fetch(url, getOptions)
=======
    // 1. Fetch current file content and latest SHA from GitHub REST API
    var getOptions = { 'method': 'get', 'headers': headers, 'muteHttpExceptions': true };
    var res = UrlFetchApp.fetch(url, getOptions);
>>>>>>> 22261d6 (feat: enhance gitHubSync with targeted insertion and 409 SHA collision retries)
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
<<<<<<< HEAD
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
=======
    if (rawContent.indexOf(entryMd.trim()) !== -1 || (commitMessage && rawContent.indexOf(commitMessage) !== -1)) {
      console.log('[gitHubSync] Idempotent Skip: Entry already exists in', filePath);
      return 'IDEMPOTENT_SKIP';
    }

    // 3. Section-Aware Insertion (Inserts into Section 3 Activity Log block)
    var updatedContent = insertEntryIntoLogSection(rawContent, entryMd);
    var base64Updated = Utilities.base64Encode(updatedContent);
>>>>>>> 22261d6 (feat: enhance gitHubSync with targeted insertion and 409 SHA collision retries)

    // 4. Commit updated content back to GitHub
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

<<<<<<< HEAD
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
=======
    var putRes = UrlFetchApp.fetch(url, putOptions);
    var statusCode = putRes.getResponseCode();

    if (statusCode === 200 || statusCode === 201) {
      console.log('[gitHubSync] Successfully committed markdown entry to GitHub:', filePath);
      return true;
    } else if (statusCode === 409) {
      // 409 Conflict: Another process updated the file SHA in split second -> retry
      console.warn('[gitHubSync] SHA collision (HTTP 409) on file:', filePath);
      return false;
    } else {
      console.error('[gitHubSync] Error committing to GitHub (HTTP ' + statusCode + '):', putRes.getContentText());
      return false;
>>>>>>> 22261d6 (feat: enhance gitHubSync with targeted insertion and 409 SHA collision retries)
    }
  } catch (e) {
    console.error('[gitHubSync] Exception calling GitHub API:', e.message)
    return false
  }
}

/**
 * Inserts entry cleanly into Section 3 (Activity Log) or inside <details> collapsible block.
 */
function insertEntryIntoLogSection(fullContent, newEntry) {
  var detailsMarker = '</details>';
  var detailsIndex = fullContent.indexOf(detailsMarker);

  if (detailsIndex !== -1) {
    // Insert entry right before closing </details> tag
    return fullContent.substring(0, detailsIndex) + newEntry + '\n' + fullContent.substring(detailsIndex);
  }

  var section3Marker = '## 3. Ingested Activity';
  var section3Index = fullContent.indexOf(section3Marker);

  if (section3Index !== -1) {
    var lineBreakIndex = fullContent.indexOf('\n', section3Index);
    return fullContent.substring(0, lineBreakIndex + 1) + newEntry + '\n' + fullContent.substring(lineBreakIndex + 1);
  }

  // Fallback: Append to bottom of file
  return fullContent + '\n' + newEntry;
}
