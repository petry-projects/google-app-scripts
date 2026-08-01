/**
 * Main entry point for Google Drive AI Ingestion & Dual-Layer Auto-Tagging Engine.
 * PROD RUNTIME: Runs autonomously 24/7 in Google Apps Script via 15-minute Cloud Trigger.
 * Continuously iterates page-by-page over ALL non-media files across the ENTIRE Google Drive.
 */

var DRIVE_AI_INGESTER_VERSION = 'v1.2.0-drive-continuous'

function processDriveFilesWithAiIngester() {
  console.log(
    '[processDriveFilesWithAiIngester] Engine Version: ' +
      DRIVE_AI_INGESTER_VERSION
  )
  console.log(
    '[processDriveFilesWithAiIngester] Starting continuous in-place AI tagging across entire Google Drive...'
  )
  var config = getDriveIngesterConfig()

  if (!config.geminiApiKey) {
    console.error(
      '[processDriveFilesWithAiIngester] GEMINI_API_KEY ScriptProperty is missing.'
    )
    return
  }

  var processedCount = 0
  var inspectedCount = 0
  var MAX_FILES_PER_RUN = 10

  try {
    console.log(
      '[processDriveFilesWithAiIngester] Searching non-trashed document files across Drive...'
    )
    var files = DriveApp.searchFiles('trashed = false')

    while (files.hasNext() && processedCount < MAX_FILES_PER_RUN) {
      var file = files.next()
      inspectedCount++

      var description = ''
      try {
        description = file.getDescription() || ''
      } catch (e) {}

      var isIndexed = description.indexOf('[AI_INDEXED]') !== -1
      var mime = file.getMimeType()

      // 1. Skip if already tagged & indexed
      if (isIndexed) {
        continue
      }

      // 2. Filter non-media document types in JavaScript
      var isDocument =
        mime === MimeType.GOOGLE_DOCS ||
        mime === MimeType.GOOGLE_SHEETS ||
        mime === MimeType.PDF ||
        mime === MimeType.PLAIN_TEXT ||
        mime.indexOf('wordprocessingml') !== -1 ||
        mime.indexOf('msword') !== -1 ||
        mime.indexOf('spreadsheet') !== -1

      if (!isDocument) {
        continue
      }

      console.log(
        '[processDriveFilesWithAiIngester] Tagging document (' +
          (processedCount + 1) +
          '/' +
          MAX_FILES_PER_RUN +
          '): "' +
          file.getName() +
          '" (' +
          mime +
          ')'
      )

      var fileText = extractFileContentText(file)
      var metadata = analyzeDocumentWithAi(file.getName(), fileText, config)

      if (metadata) {
        // 3. Apply Dual-Layer Metadata Tags (Drive Description + Embedded YAML Header)
        applyDualLayerTagsToDriveFile(file, metadata)

        // 4. Sync Executive Summary & Drive Link to GitHub self-private
        if (config.githubToken) {
          var notePath = getNotePathForDomain(
            metadata.canonicalDomain || '01_Household'
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

        console.log(
          '[processDriveFilesWithAiIngester] Successfully tagged & indexed file in-place: ' +
            file.getName()
        )
        processedCount++
      }

      // Sleep 2 seconds between files to avoid rate limits
      Utilities.sleep(2000)
    }
  } catch (err) {
    console.error(
      '[processDriveFilesWithAiIngester] Exception during Drive file iteration: ' +
        err.message
    )
  }

  console.log(
    '[processDriveFilesWithAiIngester] Execution run complete. Inspected ' +
      inspectedCount +
      ' file(s), Tagged ' +
      processedCount +
      ' document(s).'
  )
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
  return file.getName()
}

function analyzeDocumentWithAi(fileName, fileText, config) {
  var prompt =
    'Analyze this document and determine its canonical domain out of: ' +
    JSON.stringify(config.canonicalDomains) +
    '.\n\n' +
    'MANDATORY HYBRID TAG DECOMPOSITION RULE:\n' +
    "For every compound/hyphenated tag (e.g. 'toby-petry', 'five-oaks', 'credit-card', 'google-cloud'), you MUST also include each individual word component ('toby', 'petry', 'five', 'oaks', 'credit', 'card', 'google', 'cloud') in the tags array.\n\n" +
    'RULE 15 - HONEY BEEHAM & APIARY RECORDS:\n' +
    "Classify Honey BeeHam vendor inventories, wholesale price lists, apiary invoices, hive sales, and FSA honeybee colony forms under '07_Community_NonProfit' (sub-label 'Projects/Beekeeping').\n\n" +
    'DOCUMENT FILE NAME: ' +
    fileName +
    '\n' +
    'DOCUMENT TEXT SNIPPET: ' +
    fileText +
    '\n\n' +
    'Return JSON ONLY:\n' +
    '{\n' +
    '  "canonicalDomain": "07_Community_NonProfit",\n' +
    '  "subLabel": "Projects/Beekeeping",\n' +
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
    var tagsStr = (metadata.tags || []).join(', ')
    var peopleStr = (metadata.people || []).join(', ')
    var domainStr = metadata.canonicalDomain || ''
    var sublabelStr = metadata.subLabel || ''

    // 1. Layer 1: Native Drive File Description Metadata Tagging
    var currDesc = file.getDescription() || ''
    if (currDesc.indexOf('[AI_INDEXED]') === -1) {
      var tagBlock =
        '[AI_INDEXED] [AI_DOMAIN: ' +
        domainStr +
        '] sublabel: ' +
        sublabelStr +
        ' | people: ' +
        peopleStr +
        ' | tags: ' +
        tagsStr
      var newDesc = currDesc ? currDesc + '\n\n' + tagBlock : tagBlock
      file.setDescription(newDesc)
      console.log(
        '[applyDualLayerTagsToDriveFile] Set File Description metadata tags on: ' +
          file.getName()
      )
    }

    // 2. Layer 2: Embedded Document Front-Matter Header (Google Docs)
    if (file.getMimeType() === MimeType.GOOGLE_DOCS) {
      var doc = DocumentApp.openById(file.getId())
      var body = doc.getBody()

      var yamlHeader =
        '---\n' +
        'domain: ' +
        domainStr +
        '\n' +
        'sublabel: ' +
        sublabelStr +
        '\n' +
        'people: [' +
        peopleStr +
        ']\n' +
        'organization: [' +
        (metadata.organization || []).join(', ') +
        ']\n' +
        'tags: [' +
        tagsStr +
        ']\n' +
        'created: ' +
        Utilities.formatDate(file.getLastUpdated(), 'GMT', 'yyyy-MM-dd') +
        '\n' +
        '---\n\n'

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
