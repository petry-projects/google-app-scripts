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

  var threads = GmailApp.search(config.unprocessedQuery, 0, 15)
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
      '[processEmailsWithAiClassifier] Processing: ' +
        subject +
        ' from ' +
        sender
    )

    var classification = classifyWithGemini(sender, subject, snippet, config)
    if (classification && classification.canonicalDomain) {
      var targetLabel = ensureUserLabel(classification.canonicalDomain)
      thread.addLabel(targetLabel)
      console.log(
        '[processEmailsWithAiClassifier] Tagged thread with label: ' +
          classification.canonicalDomain
      )

      // Auto-Create Filter Rule if Confidence >= 0.95
      if (classification.confidence >= config.autoFilterConfidenceThreshold) {
        createGmailFilterRule(sender, classification.canonicalDomain)
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

    // Rate-Limit Safety: Sleep 1 second between email classifications to avoid API bursts
    Utilities.sleep(1000)
  }

  console.log('[processEmailsWithAiClassifier] Batch processing complete.')
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
    'Classify this email into one of these canonical domains: ' +
    JSON.stringify(config.canonicalDomains) +
    '.\n' +
    'Sender: ' +
    sender +
    '\n' +
    'Subject: ' +
    subject +
    '\n' +
    'Body Snippet: ' +
    snippet +
    '\n\n' +
    'Return JSON format ONLY: {"canonicalDomain": "...", "confidence": 0.98, "title": "Short Title", "summary": "2 sentence executive summary"}'

  var payload = {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
  }

  // Endpoint Priority Matrix: #1 Gemini 3.5 Flash Lite, #2 Gemini 3.1 Flash Lite
  var endpoints = [
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
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
          textOutput = textOutput
            .replace(/```json/g, '')
            .replace(/```/g, '')
            .trim()
          console.log(
            '[classifyWithGemini] Success using endpoint: ' + endpoints[e]
          )
          return JSON.parse(textOutput)
        }
      } else if (statusCode === 429) {
        console.warn(
          '[classifyWithGemini] Endpoint ' +
            endpoints[e] +
            ' HTTP 429 Rate Limit. Failing over to next model...'
        )
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
    '[classifyWithGemini] All Gemini model endpoints failed or rate-limited.'
  )
  return null
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
    classifyWithGemini: classifyWithGemini,
    ensureUserLabel: ensureUserLabel,
    createGmailFilterRule: createGmailFilterRule,
  }
}
