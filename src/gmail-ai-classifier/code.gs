/**
 * Main entry point for Gemini AI-Powered Semantic Email Classification and Auto-Filter Engine.
 * Runs natively inside Google Apps Script (V8 runtime).
 */

function processEmailsWithAiClassifier() {
  console.log(
    '[processEmailsWithAiClassifier] Starting AI semantic email processing...'
  )
  var config = getAiClassifierConfig()

  if (!config.geminiApiKey) {
    console.error(
      '[processEmailsWithAiClassifier] GEMINI_API_KEY ScriptProperty is missing.'
    )
    return
  }

  // Debug helper: List available models for this API key
  listAvailableGeminiModels(config)

  var threads = GmailApp.search(config.unprocessedQuery, 0, 10)
  console.log(
    '[processEmailsWithAiClassifier] Found ' +
      threads.length +
      ' unprocessed thread(s).'
  )

  if (threads.length === 0) {
    return
  }

  var processedLabel = ensureUserLabel(config.processedLabel)

  for (var i = 0; i < threads.length; i++) {
    var thread = threads[i]
    var firstMessage = thread.getMessages()[0]
    var sender = firstMessage.getFrom()
    var subject = firstMessage.getSubject()
    var snippet = firstMessage.getPlainBody().substring(0, 500)

    console.log(
      '[processEmailsWithAiClassifier] Processing (' +
        (i + 1) +
        '/' +
        threads.length +
        '): ' +
        subject +
        ' from ' +
        sender
    )

    var classification = classifyWithGemini(sender, subject, snippet, config)
    if (classification && classification.canonicalDomain) {
      var targetLabel = ensureUserLabel(classification.canonicalDomain)
      thread.addLabel(targetLabel)
      console.log(
        '[processEmailsWithAiClassifier] Tagged thread with domain label: ' +
          classification.canonicalDomain
      )

      if (classification.subLabel) {
        var subLabelObj = ensureUserLabel(classification.subLabel)
        thread.addLabel(subLabelObj)
        console.log(
          '[processEmailsWithAiClassifier] Tagged thread with sub-label: ' +
            classification.subLabel
        )
      }

      // Auto-Create Filter Rule if Confidence >= 0.95
      if (classification.confidence >= config.autoFilterConfidenceThreshold) {
        var ruleLabel =
          classification.subLabel || classification.canonicalDomain
        createGmailFilterRule(sender, ruleLabel)
      }

      // Sync Progressive Disclosure Summary to GitHub
      if (config.githubToken) {
        var notePath = getNotePathForDomain(classification.canonicalDomain)
        if (notePath) {
          var dateStr = Utilities.formatDate(
            firstMessage.getDate(),
            'GMT',
            'yyyy-MM-dd'
          )
          var entryMd = formatProgressiveDisclosureEntry(
            dateStr,
            classification.title || subject,
            sender,
            subject,
            classification.summary,
            config.userAccountEmail
          )
          appendMarkdownEntryToGitHubRepo(
            notePath,
            entryMd,
            'feat(ingestion): ' + subject
          )
        }
      }
    }

    // Apply Single Global Processed Label (preserves INBOX visibility)
    thread.addLabel(processedLabel)

    // Sleep 2 seconds between emails to avoid hitting API rate limits
    Utilities.sleep(2000)
  }

  console.log('[processEmailsWithAiClassifier] Batch processing complete.')
}

/**
 * Creates an automatic Cloud Trigger that runs email classification every 5 minutes 24/7.
 */
function setupFiveMinuteTrigger() {
  stopAllTriggers()
  ScriptApp.newTrigger('processEmailsWithAiClassifier')
    .timeBased()
    .everyMinutes(5)
    .create()
  console.log(
    '[setupFiveMinuteTrigger] Successfully established 5-minute recurring cloud trigger.'
  )
}

/**
 * Clears all active time-driven triggers for this script.
 */
function stopAllTriggers() {
  var triggers = ScriptApp.getProjectTriggers()
  for (var i = 0; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i])
  }
  console.log('[stopAllTriggers] All script triggers removed.')
}

function listAvailableGeminiModels(config) {
  var url =
    'https://generativelanguage.googleapis.com/v1beta/models?key=' +
    config.geminiApiKey
  try {
    var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true })
    if (response.getResponseCode() === 200) {
      var data = JSON.parse(response.getContentText())
      var modelNames = (data.models || []).map(function (m) {
        return m.name
      })
      console.log(
        '[listAvailableGeminiModels] Available models for key:',
        JSON.stringify(modelNames)
      )
      return modelNames
    } else {
      console.warn(
        '[listAvailableGeminiModels] HTTP ' +
          response.getResponseCode() +
          ': ' +
          response.getContentText()
      )
    }
  } catch (e) {
    console.warn(
      '[listAvailableGeminiModels] Error querying models:',
      e.message
    )
  }
  return []
}

function classifyWithGemini(sender, subject, snippet, config) {
  var prompt =
    'Classify this email into ONE of these canonical domain keys: ' +
    JSON.stringify(config.canonicalDomains) +
    '.\n\n' +
    'STRICT CLASSIFICATION RULES:\n' +
    "1. MEDIA & PLATFORM NEWSLETTERS (Medium, NYT, Substack, Epoch Times, LinkedIn digests, event/news blasts): Treat strictly as Promotional / Newsletter and return null for canonicalDomain. Do NOT classify under '06_Work_Career' or '04_Family_Health'.\n" +
    "2. UTILITY & TECH BILLS (AT&T, Google Cloud, Electric, Water): Classify under '02_Finance_Legal' (sub-label 'Finance/Banking') or '05_Tech_Infrastructure' (sub-label 'Tech/Alerts-Monitoring').\n" +
    "3. MARRIAGE & ADULT FAMILY (WinShape, Marriage retreats, DJ & Rachel personal): Classify under '04_Family_Health' (sub-label 'Family/DJ-Rachel').\n" +
    "4. BEEKEEPING & MYBROODMINDER ALERTS (MyBroodMinder, Hive telemetry, Beekeeping alerts, BOD): Classify under '07_Community_NonProfit' (sub-label 'Projects/Beekeeping').\n" +
    "5. HEALTH NEWSLETTERS & MEDICAL BULLETINS (WebMD, Epoch Health, drug recall news digests): Treat as Newsletter and return null for canonicalDomain. Reserve '04_Family_Health' strictly for personal family medical records, doctor visits, patient portals, and school/kids health notes.\n" +
    '6. E-COMMERCE PROMOTIONS & SOCIAL DIGESTS (Lowes, Nextdoor, American Meadows, Hydrobuilder): Return null for canonicalDomain.\n' +
    "7. SCHOOL PORTALS & PARENTSQUARE (ParentSquare, Magic City Acceptance Academy, MCAA, school shuttle notifications, school attendance): Classify under '04_Family_Health' (sub-label 'Family/School-Toby').\n\n" +
    'Sender: ' +
    sender +
    '\n' +
    'Subject: ' +
    subject +
    '\n' +
    'Body Snippet: ' +
    snippet +
    '\n\n' +
    'Return JSON ONLY: {"canonicalDomain": "04_Family_Health", "subLabel": "Family/School-Toby", "confidence": 0.98, "title": "Short Title", "summary": "2 sentence executive summary"}'

  var payload = {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
  }

  // Endpoint Priority Matrix featuring High-Free-Tier Gemma 4 31B and Gemini 3.x
  var endpoints = [
    'https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.0-flash:generateContent',
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
              '[classifyWithGemini] Success using endpoint: ' + endpoints[e]
            )
            return parsedObj
          }
        }
      } else if (statusCode === 429) {
        var delayMs = parseRetryDelayMs(response)
        console.warn(
          '[classifyWithGemini] Endpoint ' +
            endpoints[e] +
            ' HTTP 429 Rate Limit. Honoring Retry-After / retryDelay: sleeping ' +
            delayMs / 1000 +
            's before fallback...'
        )
        Utilities.sleep(delayMs)
      } else {
        console.warn(
          '[classifyWithGemini] Endpoint ' +
            endpoints[e] +
            ' HTTP ' +
            statusCode +
            ': ' +
            jsonText
        )
      }
    } catch (err) {
      console.warn(
        '[classifyWithGemini] Exception on endpoint ' +
          endpoints[e] +
          ': ' +
          err.message
      )
    }
  }

  console.error(
    '[classifyWithGemini] All model endpoints failed or rate-limited.'
  )
  return null
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
      console.warn(
        '[extractJsonSubstring] JSON parse error on raw substring:',
        e.message
      )
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
        return Math.min(seconds * 1000, 30000) // Cap max sleep at 30 seconds to prevent GAS execution timeout
      }
    }

    var jsonText = response.getContentText()
    var resData = JSON.parse(jsonText)
    if (resData.error && resData.error.details) {
      for (var i = 0; i < resData.error.details.length; i++) {
        var detail = resData.error.details[i]
        if (detail.retryDelay) {
          var secStr = detail.retryDelay.replace('s', '')
          var sec = parseFloat(secStr)
          if (!isNaN(sec) && sec > 0) {
            return Math.min(Math.ceil(sec * 1000), 30000)
          }
        }
      }
    }
  } catch (e) {
    console.warn('[parseRetryDelayMs] Failed to parse retry delay:', e.message)
  }
  return 5000 // 5-second default fallback
}

function ensureUserLabel(labelName) {
  var label = GmailApp.getUserLabelByName(labelName)
  if (!label) {
    label = GmailApp.createLabel(labelName)
    console.log('[ensureUserLabel] Created new label: ' + labelName)
  }
  return label
}

function createGmailFilterRule(senderEmail, targetLabelName) {
  if (typeof Gmail === 'undefined' || !Gmail.Users || !Gmail.Users.Settings) {
    console.log(
      '[createGmailFilterRule] Advanced Gmail API service not enabled in script. Skipping filter creation.'
    )
    return
  }

  try {
    var targetLabel = ensureUserLabel(targetLabelName)
    var filter = {
      criteria: { from: senderEmail },
      action: { addLabelIds: [targetLabel.getId()] },
    }
    Gmail.Users.Settings.Filters.create(filter, 'me')
    console.log(
      '[createGmailFilterRule] Created permanent Gmail filter rule for sender: ' +
        senderEmail
    )
  } catch (e) {
    console.warn(
      '[createGmailFilterRule] Filter rule creation skipped/failed:',
      e.message
    )
  }
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

function formatProgressiveDisclosureEntry(
  dateStr,
  title,
  sender,
  subject,
  summaryText,
  accountEmail
) {
  var entry = '\n### ' + dateStr + ' — ' + title + '\n'
  entry += '- **Account**: ' + accountEmail + '\n'
  entry += '- **From**: ' + sender + '\n'
  entry += '- **Subject**: ' + subject + '\n'
  if (summaryText) {
    entry += '- **Summary**:\n  > ' + summaryText.trim() + '\n'
  }
  return entry
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    processEmailsWithAiClassifier: processEmailsWithAiClassifier,
    setupFiveMinuteTrigger: setupFiveMinuteTrigger,
    stopAllTriggers: stopAllTriggers,
    classifyWithGemini: classifyWithGemini,
    ensureUserLabel: ensureUserLabel,
    createGmailFilterRule: createGmailFilterRule,
  }
}
