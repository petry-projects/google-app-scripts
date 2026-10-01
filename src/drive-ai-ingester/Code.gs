/**
 * Main entry point for Google Drive AI Ingestion & Dual-Layer Auto-Tagging Engine.
 * PROD RUNTIME: Runs autonomously 24/7 in Google Apps Script via 15-minute Cloud Trigger.
 * Continuously iterates page-by-page over ALL non-media files across the ENTIRE Google Drive.
 */

var DRIVE_AI_INGESTER_VERSION = 'v1.4.0-drive-continuous'

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

  // Concurrency guard: the 15-minute trigger can overlap with a still-running
  // execution. Without a lock, two runs could both pass the [AI_INDEXED] check
  // for the same file and race on the same GitHub file (SHA conflict) while both
  // mark the Drive file indexed. A single script lock serializes runs.
  var lock = LockService.getScriptLock()
  if (!lock.tryLock(1000)) {
    console.log(
      '[processDriveFilesWithAiIngester] Another ingestion run is in progress; skipping this trigger.'
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

      // 2. Filter to document types whose CONTENTS we can actually extract.
      // Sheets, PDFs, Word/Excel, etc. are intentionally excluded until
      // type-specific extraction exists: admitting them would send only the
      // filename to the AI, producing tags/summaries that ignore the document
      // body and permanently mark the file [AI_INDEXED] with a misclassification.
      var isDocument =
        mime === MimeType.GOOGLE_DOCS || mime === MimeType.PLAIN_TEXT

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
        // 3. Apply Dual-Layer Metadata Tags. Only proceed to GitHub sync,
        // success logging, and the processed counter when the [AI_INDEXED]
        // marker was actually persisted; otherwise leave the file eligible for
        // retry on a later run.
        var tagged = applyDualLayerTagsToDriveFile(file, metadata)
        if (!tagged) {
          console.warn(
            '[processDriveFilesWithAiIngester] Tagging failed; skipping GitHub sync and leaving file for retry: ' +
              file.getName()
          )
          Utilities.sleep(2000)
          continue
        }

        // 4. Sync Executive Summary & Drive Link to GitHub self-private
        if (config.githubToken) {
          var notePath = getNotePathForDomain(
            metadata.canonicalDomain || '01_Household',
            metadata.subLabel
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

      Utilities.sleep(2000)
    }
  } catch (err) {
    console.error(
      '[processDriveFilesWithAiIngester] Exception during Drive file iteration: ' +
        err.message
    )
  } finally {
    lock.releaseLock()
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
 * Clears only this ingester's own time-driven triggers, leaving unrelated
 * project automation (e.g. other handlers) intact.
 */
function stopAllDriveTriggers() {
  var triggers = ScriptApp.getProjectTriggers()
  var removed = 0
  for (var i = 0; i < triggers.length; i++) {
    if (
      triggers[i].getHandlerFunction() === 'processDriveFilesWithAiIngester'
    ) {
      ScriptApp.deleteTrigger(triggers[i])
      removed++
    }
  }
  console.log(
    '[stopAllDriveTriggers] Removed ' +
      removed +
      ' processDriveFilesWithAiIngester trigger(s).'
  )
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
    "For every compound/hyphenated tag (e.g. 'smart-home', 'service-receipt', 'credit-card', 'cloud-server'), you MUST also include each individual word component ('smart', 'home', 'service', 'receipt', 'credit', 'card', 'cloud', 'server') in the tags array.\n\n" +
    'RULE 15 - SMALL BUSINESS, ARTISANAL CRAFT & HOBBY SALES:\n' +
    "Classify small business and artisanal craft vendor inventories, wholesale price lists, invoices, and sales receipts under '01_Household' (sub-label 'Projects/Business') or '02_Finance_Legal' (sub-label 'Finance/Purchases' if pure purchase receipt/invoice).\n\n" +
    'RULE 16 - TAX FORMS, CHARITABLE DONATIONS & COURT ORDERS:\n' +
    "Classify tax forms (1095-C, 1098, W2, tax returns), charitable donation receipts, court orders, and legal work orders under '02_Finance_Legal' (sub-labels 'Finance/Taxes', 'Finance/Charitable-Donations', or 'Finance/Legal').\n\n" +
    'RULE 18 - CAR RENTALS & TRAVEL RESERVATION CONFIRMATIONS:\n' +
    "Classify car rental agreements, Hertz/Avis/Enterprise check-ins, airline tickets, hotel reservations, and travel itineraries under '01_Household' (sub-label 'Household/Travel') or '03_Vehicles' (sub-label 'Vehicles/Rental-Cars').\n\n" +
    'DOCUMENT FILE NAME: ' +
    fileName +
    '\n' +
    'DOCUMENT TEXT SNIPPET: ' +
    fileText +
    '\n\n' +
    'Return JSON ONLY:\n' +
    '{\n' +
    '  "canonicalDomain": "01_Household",\n' +
    '  "subLabel": "Household/Travel",\n' +
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

  // Cascading High-Quality Gemini 3.x Model Matrix
  var endpoints = [
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent',
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

/**
 * Applies the two metadata layers to a Drive file. Returns true ONLY when the
 * [AI_INDEXED] marker is persisted in the file description (Layer 1) — that
 * marker is what suppresses reprocessing on later runs. A Layer 2 (embedded
 * front-matter) failure is logged but does not flip the status, because the
 * marker is already persisted. If Layer 1 fails, returns false so the caller
 * skips GitHub sync and leaves the file eligible for retry on the next run.
 */
function applyDualLayerTagsToDriveFile(file, metadata) {
  var tagsStr = (metadata.tags || []).join(', ')
  var peopleStr = (metadata.people || []).join(', ')
  var domainStr = metadata.canonicalDomain || ''
  var sublabelStr = metadata.subLabel || ''

  // 1. Layer 1: Native Drive File Description Metadata Tagging (persists [AI_INDEXED])
  try {
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
  } catch (e) {
    console.error(
      '[applyDualLayerTagsToDriveFile] Layer 1 failed; [AI_INDEXED] NOT persisted for ' +
        file.getName() +
        ': ' +
        e.message
    )
    return false
  }

  // 2. Layer 2: Embedded Document Front-Matter Header (Google Docs).
  // Best-effort: the indexing marker is already persisted above.
  try {
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
      '[applyDualLayerTagsToDriveFile] Layer 2 (front-matter) failed for ' +
        file.getName() +
        ' (marker already persisted): ' +
        e.message
    )
  }

  return true
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

function getNotePathForDomain(domain, subLabel) {
  var map = {
    '01_Household': '01_Household/index.md',
    '02_Finance_Legal': '02_Finance_Legal/index.md',
    '03_Vehicles': '03_Vehicles/index.md',
    '04_Family_Health': '04_Family_Health/index.md',
    '05_Tech_Infrastructure': '05_Tech_Infrastructure/index.md',
    '06_Work_Career': '06_Work_Career/index.md',
    '07_Community_NonProfit': '07_Community_NonProfit/index.md',
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
