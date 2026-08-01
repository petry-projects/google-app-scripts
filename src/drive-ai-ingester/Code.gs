/**
 * Main entry point for Google Drive AI Ingestion & Dual-Layer Auto-Tagging Engine.
 * Runs natively inside Google Apps Script (V8 runtime).
 */

function processDriveFilesWithAiIngester() {
  console.log(
    '[processDriveFilesWithAiIngester] Starting Google Drive AI file ingestion...'
  )
  var config = getDriveIngesterConfig()

  if (!config.geminiApiKey) {
    console.error(
      '[processDriveFilesWithAiIngester] GEMINI_API_KEY ScriptProperty is missing.'
    )
    return
  }

  // Scan 7 Canonical Domain Folders in Google Drive
  for (var d = 0; d < config.canonicalDomains.length; d++) {
    var domainFolder = config.canonicalDomains[d]
    var folders = DriveApp.getFoldersByName(domainFolder)

    while (folders.hasNext()) {
      var folder = folders.next()
      var files = folder.getFiles()

      while (files.hasNext()) {
        var file = files.next()

        // Check if file has already been indexed
        var isIndexed = file.getCustomProperty('indexed')
        if (isIndexed === 'true') {
          continue
        }

        console.log(
          '[processDriveFilesWithAiIngester] Ingesting file: ' +
            file.getName() +
            ' in folder: ' +
            domainFolder
        )

        var fileText = extractFileContentText(file)
        var metadata = analyzeDocumentWithAi(
          file.getName(),
          fileText,
          domainFolder,
          config
        )

        if (metadata) {
          // 1. Apply Dual-Layer Tags (Drive API Properties + Embedded YAML Header)
          applyDualLayerTagsToDriveFile(file, metadata)

          // 2. Sync Executive Summary & Drive URL to GitHub self-private
          if (config.githubToken) {
            var notePath = getNotePathForDomain(
              metadata.canonicalDomain || domainFolder
            )
            if (notePath) {
              var dateStr = Utilities.formatDate(
                file.getLastUpdated(),
                'GMT',
                'yyyy-MM-dd'
              )
              var entryMd = formatDriveIngestionEntry(
                dateStr,
                metadata.title || file.getName(),
                file.getUrl(),
                metadata.summary,
                metadata.tags,
                metadata.people,
                config.userAccountEmail
              )
              appendMarkdownEntryToGitHubRepo(
                notePath,
                entryMd,
                'feat(drive-ingest): ' + file.getName()
              )
            }
          }

          // 3. Mark File as Indexed
          file.setCustomProperty('indexed', 'true')
          console.log(
            '[processDriveFilesWithAiIngester] Successfully indexed and tagged file: ' +
              file.getName()
          )
        }

        // Sleep 2 seconds between files to avoid rate limits
        Utilities.sleep(2000)
      }
    }
  }

  console.log('[processDriveFilesWithAiIngester] Drive ingestion complete.')
}

/**
 * Creates an automatic Cloud Trigger that runs Drive Ingestion every 15 minutes.
 */
function setupFifteenMinuteDriveTrigger() {
  stopAllDriveTriggers()
  ScriptApp.newTrigger('processDriveFilesWithAiIngester')
    .timeBased()
    .everyMinutes(15)
    .create()
  console.log(
    '[setupFifteenMinuteDriveTrigger] Established 15-minute recurring cloud trigger for Drive Ingester.'
  )
}

/**
 * Clears all active time-driven triggers for this script.
 */
function stopAllDriveTriggers() {
  var triggers = ScriptApp.getProjectTriggers()
  for (var i = 0; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i])
  }
  console.log('[stopAllDriveTriggers] All script triggers removed.')
}

function extractFileContentText(file) {
  try {
    var mime = file.getMimeType()
    if (mime === MimeType.GOOGLE_DOCS) {
      return DocumentApp.openById(file.getId())
        .getBody()
        .getText()
        .substring(0, 3000)
    } else if (mime === MimeType.PLAIN_TEXT) {
      return file.getBlob().getDataAsString().substring(0, 3000)
    }
  } catch (e) {
    console.warn(
      '[extractFileContentText] Could not extract text from file ' +
        file.getName() +
        ': ' +
        e.message
    )
  }
  return file.getName() // Fallback to file name if binary/image
}

function analyzeDocumentWithAi(fileName, fileText, domainFolder, config) {
  var prompt =
    "Analyze this document for household knowledge indexing into canonical domain: '" +
    domainFolder +
    "'.\n\n" +
    'MANDATORY HYBRID TAG DECOMPOSITION RULE:\n' +
    "For every compound/hyphenated tag (e.g. 'toby-petry', 'five-oaks', 'credit-card', 'google-cloud'), you MUST also include each individual word component ('toby', 'petry', 'five', 'oaks', 'credit', 'card', 'google', 'cloud') in the tags array.\n\n" +
    'DOCUMENT FILE NAME: ' +
    fileName +
    '\n' +
    'DOCUMENT TEXT SNIPPET: ' +
    fileText +
    '\n\n' +
    'Return JSON ONLY:\n' +
    '{\n' +
    '  "canonicalDomain": "' +
    domainFolder +
    '",\n' +
    '  "subLabel": "Finance/Banking",\n' +
    '  "title": "Short Document Title",\n' +
    '  "people": ["Full Name 1", "Full Name 2"],\n' +
    '  "organization": ["Org / Institution Name"],\n' +
    '  "tags": ["compound-tag", "compound", "tag", "person-name", "person", "name"],\n' +
    '  "summary": "2 sentence executive summary of document contents."\n' +
    '}'

  var payload = {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
  }

  var endpoints = [
    'https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent',
  ]

  for (var e = 0; e < endpoints.length; e++) {
    var url = endpoints[e] + '?key=' + config.geminiApiKey
    var options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    }

    try {
      var response = UrlFetchApp.fetch(url, options)
      var statusCode = response.getResponseCode()
      var jsonText = response.getContentText()

      if (statusCode === 200) {
        var resData = JSON.parse(jsonText)
        if (
          resData.candidates &&
          resData.candidates[0] &&
          resData.candidates[0].content &&
          resData.candidates[0].content.parts &&
          resData.candidates[0].content.parts[0]
        ) {
          var textOutput = resData.candidates[0].content.parts[0].text
          var parsedObj = extractJsonSubstring(textOutput)
          if (parsedObj) {
            console.log(
              '[analyzeDocumentWithAi] Success using endpoint: ' + endpoints[e]
            )
            return parsedObj
          }
        }
      } else if (statusCode === 429) {
        var delayMs = parseRetryDelayMs(response)
        console.warn(
          '[analyzeDocumentWithAi] Endpoint ' +
            endpoints[e] +
            ' HTTP 429 Rate Limit: sleeping ' +
            delayMs / 1000 +
            's...'
        )
        Utilities.sleep(delayMs)
      }
    } catch (err) {
      console.warn(
        '[analyzeDocumentWithAi] Exception on endpoint ' +
          endpoints[e] +
          ': ' +
          err.message
      )
    }
  }

  return null
}

function applyDualLayerTagsToDriveFile(file, metadata) {
  try {
    // 1. Layer 1: Drive API Custom Properties
    var tagsStr = (metadata.tags || []).join(', ')
    var peopleStr = (metadata.people || []).join(', ')
    file.setCustomProperty('tags', tagsStr)
    file.setCustomProperty('people', peopleStr)
    file.setCustomProperty('domain', metadata.canonicalDomain || '')
    file.setCustomProperty('sublabel', metadata.subLabel || '')

    // 2. Layer 2: Embedded Document Front-Matter Header (Google Docs)
    if (file.getMimeType() === MimeType.GOOGLE_DOCS) {
      var doc = DocumentApp.openById(file.getId())
      var body = doc.getBody()

      var yamlHeader =
        '---\n' +
        'domain: ' +
        (metadata.canonicalDomain || '') +
        '\n' +
        'sublabel: ' +
        (metadata.subLabel || '') +
        '\n' +
        'people: [' +
        (metadata.people || []).join(', ') +
        ']\n' +
        'organization: [' +
        (metadata.organization || []).join(', ') +
        ']\n' +
        'tags: [' +
        (metadata.tags || []).join(', ') +
        ']\n' +
        'created: ' +
        Utilities.formatDate(file.getLastUpdated(), 'GMT', 'yyyy-MM-dd') +
        '\n' +
        '---\n\n'

      // Check if header already exists
      var text = body.getText()
      if (text.indexOf('---') !== 0) {
        body.insertParagraph(0, yamlHeader)
        console.log(
          '[applyDualLayerTagsToDriveFile] Embedded YAML front-matter header into Google Doc: ' +
            file.getName()
        )
      }
    }
  } catch (e) {
    console.warn(
      '[applyDualLayerTagsToDriveFile] Error applying dual-layer tags: ' +
        e.message
    )
  }
}

function extractJsonSubstring(text) {
  if (!text) return null
  text = text
    .replace(/```json/gi, '')
    .replace(/```/gi, '')
    .trim()

  var start = text.indexOf('{')
  var end = text.lastIndexOf('}')
  if (start !== -1 && end !== -1 && end > start) {
    var rawJson = text.substring(start, end + 1)
    try {
      return JSON.parse(rawJson)
    } catch (e) {
      console.warn('[extractJsonSubstring] JSON parse error:', e.message)
    }
  }
  return null
}

function parseRetryDelayMs(response) {
  try {
    var headers = response.getHeaders()
    var retryHeader = headers['Retry-After'] || headers['retry-after']
    if (retryHeader) {
      var seconds = parseInt(retryHeader, 10)
      if (!isNaN(seconds) && seconds > 0) {
        return Math.min(seconds * 1000, 30000)
      }
    }
  } catch (e) {}
  return 5000
}

function getNotePathForDomain(domain) {
  var map = {
    '01_Household': 'petry-household/birmingham/index.md',
    '02_Finance_Legal': 'petry-household/finances/index.md',
    '03_Vehicles': 'petry-household/vehicles/index.md',
    '04_Family_Health': 'petry-household/kids/index.md',
    '05_Tech_Infrastructure':
      'petry-household/our-technology/digital-backups/index.md',
    '06_Work_Career': 'dp-work-notes/notes/index.md',
    '07_Community_NonProfit':
      'helpingoneguy/organization/organization/index.md',
  }
  return map[domain] || null
}

function formatDriveIngestionEntry(
  dateStr,
  title,
  driveUrl,
  summaryText,
  tagsList,
  peopleList,
  accountEmail
) {
  var entry = '\n### ' + dateStr + ' — [' + title + '](' + driveUrl + ')\n'
  entry += '- **Account**: ' + accountEmail + '\n'
  if (peopleList && peopleList.length > 0) {
    entry += '- **People**: ' + peopleList.join(', ') + '\n'
  }
  if (tagsList && tagsList.length > 0) {
    entry += '- **Tags**: `' + tagsList.join('`, `') + '`\n'
  }
  if (summaryText) {
    entry += '- **Summary**:\n  > ' + summaryText.trim() + '\n'
  }
  return entry
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    processDriveFilesWithAiIngester: processDriveFilesWithAiIngester,
    setupFifteenMinuteDriveTrigger: setupFifteenMinuteDriveTrigger,
    stopAllDriveTriggers: stopAllDriveTriggers,
  }
}
