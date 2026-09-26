/**
 * Main entry point for Gemini AI-Powered Semantic Email Classification and Auto-Filter Engine.
 * Runs natively inside Google Apps Script (V8 runtime).
 */

var GMAIL_AI_CLASSIFIER_VERSION = 'v1.7.0-strict-single-label-no-autofilters'

function processEmailsWithAiClassifier() {
  console.log(
    '[processEmailsWithAiClassifier] Engine Version: ' +
      GMAIL_AI_CLASSIFIER_VERSION
  )
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
    if (classification) {
      // Clean up any pre-existing conflicting core domain labels, sub-labels, flat labels, and Retention/Permanent
      cleanConflictingLabels(
        thread,
        classification.canonicalDomain,
        classification.subLabel,
        config
      )

      // 1. Single Primary Label Tagging (Sub-label preferred; canonicalDomain if no sub-label)
      var primaryTag = classification.subLabel || classification.canonicalDomain
      if (primaryTag) {
        var targetLabel = ensureUserLabel(primaryTag)
        thread.addLabel(targetLabel)
        console.log(
          '[processEmailsWithAiClassifier] Tagged thread with single primary label: ' +
            primaryTag
        )

        // Note: Permanent Gmail filter auto-creation is deactivated to prevent
        // filter duplication, cumulative rule firing, and multi-label collisions.

        // Sync Progressive Disclosure Summary to GitHub
        if (config.githubToken) {
          var notePath = getNotePathForDomain(
            classification.canonicalDomain,
            classification.subLabel
          )
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
            assertNoAsciiReplacement_(
              (subject || '') + (classification.summary || ''),
              entryMd
            )
            assertClean_(entryMd, 'new entry for ' + notePath)
            appendMarkdownEntryToGitHubRepo(
              notePath,
              entryMd,
              'feat(ingestion): ' + subject
            )
          }
        }
      }

      // 2. Action Handling (Trash, Archive, Mark Read)
      // Safety Shield: Never trash or archive threads sent/replied by the user!
      var userSent = isThreadSentOrRepliedByUser(
        thread,
        config.userAccountEmail
      )
      if (!userSent) {
        if (classification.action === 'trash') {
          thread.moveToTrash()
          console.log(
            '[processEmailsWithAiClassifier] Action: Moved spam/unwanted thread to TRASH.'
          )
        } else if (classification.action === 'archive') {
          thread.moveToArchive()
          console.log(
            '[processEmailsWithAiClassifier] Action: Archived thread out of INBOX.'
          )
        }
      } else {
        console.log(
          '[processEmailsWithAiClassifier] Shield: Preserved thread in INBOX because user sent/replied to it.'
        )
      }

      if (classification.action === 'mark_read' || classification.markRead) {
        thread.markRead()
        console.log(
          '[processEmailsWithAiClassifier] Action: Marked thread as READ.'
        )
      }
    }

    // Apply Single Global Processed Label (preserves INBOX visibility unless trashed/archived)
    thread.addLabel(processedLabel)

    // Sleep 2 seconds between emails to avoid hitting API rate limits
    Utilities.sleep(2000)
  }

  console.log('[processEmailsWithAiClassifier] Batch processing complete.')
}

/**
 * Removes any pre-existing conflicting Core Domain labels, Sub-Labels, legacy flat labels,
 * and redundant 'Retention/Permanent' tags to enforce a strict, clean label budget.
 */
function cleanConflictingLabels(thread, targetDomain, targetSubLabel, config) {
  try {
    var existingLabels = thread.getLabels()
    var canonicalDomains = config.canonicalDomains || []

    var legacyFlatLabels = [
      'Finance',
      'Household',
      'Family',
      'Projects',
      'Work',
      'Community',
      'Tech',
      'Purchases',
      'Banking',
      'Bills',
      'eBills',
      'Insurance',
      'iDCFS',
      'Naomi',
      'Sent',
      'Archives',
    ]

    for (var j = 0; j < existingLabels.length; j++) {
      var lObj = existingLabels[j]
      var lName = lObj.getName()

      // 1. Strip redundant Retention/Permanent (Inverted Model: blank = permanent)
      if (lName === 'Retention/Permanent') {
        thread.removeLabel(lObj)
        console.log(
          '[cleanConflictingLabels] Stripped Retention/Permanent: ' + lName
        )
        continue
      }

      // 2. Protect valid short-lived retention expiration tags
      if (lName.indexOf('Retention/') === 0) {
        continue
      }

      // 3. Protect global status and system labels
      if (lName === (config.processedLabel || 'Processed')) {
        continue
      }

      // 4. Clean legacy flat labels
      for (var f = 0; f < legacyFlatLabels.length; f++) {
        if (lName.toLowerCase() === legacyFlatLabels[f].toLowerCase()) {
          thread.removeLabel(lObj)
          console.log(
            '[cleanConflictingLabels] Stripped legacy flat label: ' + lName
          )
          break
        }
      }

      // 5. Clean conflicting or redundant Core Domain labels
      for (var d = 0; d < canonicalDomains.length; d++) {
        var cd = canonicalDomains[d]
        // If thread has a sub-label, strip core domain codes (e.g. 01_Household) to avoid double-tagging
        if (lName === cd && (targetSubLabel || cd !== targetDomain)) {
          thread.removeLabel(lObj)
          console.log(
            '[cleanConflictingLabels] Removed domain code label: ' + lName
          )
          break
        }
      }

      // 6. Clean conflicting sub-labels if they don't match targetSubLabel
      if (
        lName.indexOf('/') !== -1 &&
        lName !== targetSubLabel &&
        lName.indexOf('Archives') === -1 &&
        lName.indexOf('Retention/') === -1
      ) {
        // Also handle the Family/DJ-Rachel vs Family/DJ & Rachel alias
        if (
          (targetSubLabel === 'Family/DJ & Rachel' &&
            lName === 'Family/DJ-Rachel') ||
          (targetSubLabel === 'Family/DJ-Rachel' &&
            lName === 'Family/DJ & Rachel')
        ) {
          if (lName !== targetSubLabel) {
            thread.removeLabel(lObj)
            console.log(
              '[cleanConflictingLabels] Cleaned alternate alias label: ' + lName
            )
          }
        } else {
          thread.removeLabel(lObj)
          console.log(
            '[cleanConflictingLabels] Removed conflicting sub-label: ' + lName
          )
        }
      }
    }
  } catch (e) {
    console.warn('[cleanConflictingLabels] Error cleaning labels: ' + e.message)
  }
}

/**
 * Automatically purges emails older than their category retention policy (2 years for Promotions/Social/Forums).
 * Core household domains (01_Household - 07_Community_NonProfit), Primary, Updates, Starred, and User Replied/Sent threads are 100% EXEMPT.
 */
function purgeExpiredEmailsByRetentionPolicy() {
  console.log(
    '[purgeExpiredEmailsByRetentionPolicy] Starting weekly category retention cleanup...'
  )
  var config = getAiClassifierConfig()

  // Explicitly exclude threads sent by user or containing user replies
  var retentionQuery =
    '(category:promotions OR category:social OR category:forums) older_than:2y -is:starred -from:me'

  var threads = GmailApp.search(retentionQuery, 0, 50)
  console.log(
    '[purgeExpiredEmailsByRetentionPolicy] Found ' +
      threads.length +
      ' expired thread(s) matching 2-year retention query.'
  )

  if (threads.length === 0) {
    return
  }

  var coreDomainLabels = config.canonicalDomains
  var trashedCount = 0

  for (var i = 0; i < threads.length; i++) {
    var thread = threads[i]
    var labels = thread.getLabels()
    var isExempt = false

    // Safety Shield 1: Check if thread contains any Core Household Domain label
    for (var l = 0; l < labels.length; l++) {
      var labelName = labels[l].getName()
      for (var cd = 0; cd < coreDomainLabels.length; cd++) {
        if (labelName.indexOf(coreDomainLabels[cd]) !== -1) {
          isExempt = true
          break
        }
      }
      if (isExempt) break
    }

    // Safety Shield 2: Check if user sent a message or replied in this thread
    if (!isExempt) {
      if (isThreadSentOrRepliedByUser(thread, config.userAccountEmail)) {
        isExempt = true
      }
    }

    if (!isExempt) {
      thread.moveToTrash()
      trashedCount++
    } else {
      console.log(
        '[purgeExpiredEmailsByRetentionPolicy] Exempted thread from trash (contains core domain label or user reply): ' +
          thread.getFirstMessageSubject()
      )
    }
  }

  console.log(
    '[purgeExpiredEmailsByRetentionPolicy] Retention cleanup complete. Moved ' +
      trashedCount +
      ' expired thread(s) to Trash.'
  )
}

/**
 * Checks if a thread contains any messages sent or replied by the account owner.
 */
function isThreadSentOrRepliedByUser(thread, userEmail) {
  try {
    var messages = thread.getMessages()
    var primaryEmail = (
      userEmail ||
      Session.getEffectiveUser().getEmail() ||
      ''
    ).toLowerCase()
    for (var m = 0; m < messages.length; m++) {
      var fromAddr = messages[m].getFrom().toLowerCase()
      if (primaryEmail && fromAddr.indexOf(primaryEmail) !== -1) {
        return true
      }
    }
  } catch (e) {
    console.warn(
      '[isThreadSentOrRepliedByUser] Error checking message senders:',
      e.message
    )
  }
  return false
}

/**
 * Sets up a weekly cloud trigger to run purgeExpiredEmailsByRetentionPolicy every Sunday at 1:00 AM.
 */
function setupWeeklyRetentionTrigger() {
  var triggers = ScriptApp.getProjectTriggers()
  for (var i = 0; i < triggers.length; i++) {
    if (
      triggers[i].getHandlerFunction() === 'purgeExpiredEmailsByRetentionPolicy'
    ) {
      ScriptApp.deleteTrigger(triggers[i])
    }
  }

  ScriptApp.newTrigger('purgeExpiredEmailsByRetentionPolicy')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(1)
    .create()

  console.log(
    '[setupWeeklyRetentionTrigger] Established weekly Sunday 1:00 AM retention cleanup trigger.'
  )
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
  setupWeeklyRetentionTrigger()
  console.log(
    '[setupFiveMinuteTrigger] Successfully established 5-minute recurring cloud trigger and weekly retention trigger.'
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
    "1. MEDIA & PLATFORM NEWSLETTERS (Medium, NYT, Substack, Epoch Times, LinkedIn digests, event/news blasts): Treat strictly as Promotional / Newsletter and return null for canonicalDomain. Do NOT classify under '06_Work_Career' or '04_Family_Health'. Set category to 'Promotions' or 'Social', action to 'keep'.\n" +
    "2. UTILITY & TECH BILLS (AT&T, Google Cloud, Electric, Water): Classify under '02_Finance_Legal' (sub-label 'Finance/Banking') or '05_Tech_Infrastructure' (sub-label 'Tech/Alerts-Monitoring'). Set category to 'Updates', action to 'keep'.\n" +
    "3. MARRIAGE & ADULT FAMILY (WinShape, Marriage retreats, DJ & Rachel personal correspondence): Classify under '04_Family_Health' (sub-label 'Family/DJ & Rachel'). Set category to 'Primary', action to 'keep'. Note: If an email is about Rachel's business/hobby Honey BeeHam or candle making, do NOT label as Family/DJ & Rachel; classify under '01_Household' (sub-label 'Projects/HoneyBeeHam').\n" +
    "4. NON-PROFIT CHARITY & BEEKEEPING ASSOCIATION (Helping One Guy / HOG 501(c)(3) charity records, Jefferson County Beekeepers Association Board of Directors / JeffCo Bees BOD official non-profit communications, Faith outreach, and MyBroodMinder hive telemetry alerts): Classify strictly under '07_Community_NonProfit' (sub-labels 'Projects/HOG', 'Community/JeffCo-Bees-BOD', or 'Projects/Beekeeping'). Set category to 'Updates', action to 'keep'. Do NOT classify commercial Honey BeeHam vendor, candle craft, jar packaging, or honey sales here.\n" +
    "5. HEALTH NEWSLETTERS & MEDICAL BULLETINS (WebMD, Epoch Health, drug recall news digests): Treat as Newsletter and return null for canonicalDomain. Reserve '04_Family_Health' strictly for personal family medical records, doctor visits, patient portals, and school/kids health notes.\n" +
    "6. E-COMMERCE PROMOTIONS & SOCIAL DIGESTS (Lowes, Nextdoor, American Meadows, Hydrobuilder, OpenAI pricing promos): Return null for canonicalDomain. Set category to 'Promotions' or 'Social'.\n" +
    "7. SCHOOL PORTALS & PARENTSQUARE (ParentSquare, Magic City Acceptance Academy, MCAA, school shuttle notifications, school attendance): Classify under '04_Family_Health' (sub-label 'Family/School-Toby'). Set category to 'Updates' or 'Primary', action to 'keep'.\n" +
    "8. TECH WEBINARS & PRODUCT MARKETING (Google Cloud webinars, 'Register Now', product marketing, tech promos): Treat as Promotional / Marketing and return null for canonicalDomain. Reserve '05_Tech_Infrastructure' strictly for active system alerts, security warnings, spend cap notifications, and project quota/outage alerts.\n" +
    "9. HOBBY & STORE MARKETING (Lorob Bees, Foxhound Bee Company, e-commerce store newsletters, product announcements): Treat as Promotional / Marketing and return null for canonicalDomain. Reserve '07_Community_NonProfit' / 'Projects/Beekeeping' strictly for active hive telemetry alerts (MyBroodMinder) and official non-profit BOD communications.\n" +
    "10. SPAM & PHISHING & UNWANTED SOLICITATION: Set action to 'trash'.\n" +
    "11. ROUTINE NOISY NOTIFICATIONS (Known daily digest notifications that require no reading): Set action to 'mark_read' or 'archive'.\n" +
    "12. ORDER CONFIRMATIONS & RECEIPTS (Order confirmations, purchase receipts, invoices, delivery confirmations, payment receipts): Classify under '02_Finance_Legal' (sub-label 'Finance/Purchases') or '01_Household' / '03_Vehicles' as appropriate. Treat strictly as financial/purchase records (category 'Updates', action 'keep'). Do NOT classify as Promotional or Trash.\n" +
    "13. SINGLE SUB-LABEL RULE: Return AT MOST ONE subLabel string per email (the single best matching sub-label, e.g. 'Finance/Banking' or 'Family/School-Toby'). Do NOT stack multiple sub-labels.\n" +
    "14. UNSOLICITED REAL ESTATE & INVESTMENT SOLICITATION (Cold wholesaler property blasts, 'Off-Market Investment Opportunity', 'We Buy Houses', unsolicited real estate deal blasts): Treat as Promotional / Solicitation and return null for canonicalDomain. Do NOT classify under '02_Finance_Legal' or '01_Household'. Reserve '02_Finance_Legal' strictly for personal bank statements, mortgages, tax documents, credit cards, and active legal records.\n" +
    "15. HONEY BEEHAM ARTISANAL BUSINESS & CANDLE CRAFT (Honey BeeHam, honey4beeham@gmail.com, beeswax candles, candle molds, Etsy beekeeping supplies, The Cary Company jars/lids, Square/Venmo market sales, Pepper Place, Made Market Franklin, Bham Coffee Fest, farmer markets, cottage food law, FSA colony forms): Classify strictly under '01_Household' (sub-label 'Projects/HoneyBeeHam') or '02_Finance_Legal' (sub-label 'Finance/Purchases' if pure purchase receipt/invoice). Set category to 'Updates', action to 'keep'. Under NO circumstances classify Honey BeeHam under '07_Community_NonProfit'!\n" +
    "16. TAX FORMS, CHARITABLE DONATIONS & COURT ORDERS (1095-C, 1098, W2, tax returns, donation receipts, court orders, legal closing orders): Classify under '02_Finance_Legal' (sub-labels 'Finance/Taxes', 'Finance/Charitable-Donations', or 'Finance/Legal'). Set category to 'Updates', action to 'keep'.\n" +
    "17. JOB POSTINGS, RESUMES & CAREER INTERVIEWS (Southern Power Company job announcements, interview schedules, resume feedback, ShePoint postings): Classify under '06_Work_Career' (sub-label 'Work/Career-Rachel' or 'Work/Career-DJ'). Set category to 'Primary' or 'Updates', action to 'keep'.\n" +
    "18. CAR RENTALS & TRAVEL RESERVATION CONFIRMATIONS (Hertz, Avis, Enterprise, National, Delta, United, Marriott, Airbnb, travel check-ins): Classify under '01_Household' (sub-label 'Household/Travel') or '03_Vehicles' (sub-label 'Vehicles/Rental-Cars'). Set category to 'Updates', action to 'keep'.\n\n" +
    'Sender: ' +
    sender +
    '\n' +
    'Subject: ' +
    subject +
    '\n' +
    'Body Snippet: ' +
    snippet +
    '\n\n' +
    'Return JSON ONLY: {"canonicalDomain": "01_Household", "subLabel": "Household/Travel", "category": "Updates", "action": "keep", "confidence": 0.98, "title": "Short Title", "summary": "2 sentence executive summary"}\n' +
    "Valid categories: 'Primary', 'Updates', 'Promotions', 'Social', 'Forums'.\n" +
    "Valid actions: 'keep', 'archive', 'trash', 'mark_read'."

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
        return Math.min(seconds * 1000, 30000)
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
  return 5000
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
  // Decommissioned: Static filter auto-creation causes multi-label collisions,
  // filter bloat, and duplicate rules across multi-purpose senders.
  console.log(
    '[createGmailFilterRule] Permanent filter auto-creation is permanently decommissioned. No-op.'
  )
}

function getNotePathForDomain(domain, subLabel) {
  if (
    subLabel === 'Projects/HoneyBeeHam' ||
    subLabel === 'Household/HoneyBeeHam'
  ) {
    return 'petry-household/birmingham/index.md'
  }
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

/**
 * Computes search date range object ({ after: 'YYYY/MM/DD', before: 'YYYY/MM/DD' }) around a given date string.
 */
function getSearchDateRange_(dateStr, days) {
  var parts = dateStr.split('-')
  var year = parseInt(parts[0], 10)
  var month = parseInt(parts[1], 10) - 1
  var day = parseInt(parts[2], 10)
  var dt = new Date(year, month, day)

  var beforeDt = new Date(dt.getTime() + (days + 1) * 86400000)
  var afterDt = new Date(dt.getTime() - days * 86400000)

  function fmt(d) {
    var y = d.getFullYear()
    var m = ('0' + (d.getMonth() + 1)).slice(-2)
    var da = ('0' + d.getDate()).slice(-2)
    return y + '/' + m + '/' + da
  }
  return { after: fmt(afterDt), before: fmt(beforeDt) }
}

/**
 * Searches Gmail for original raw subject and from header corresponding to a damaged entry.
 */
function searchGmailForOriginalHeader_(senderEmail, dateStr, damagedSubject) {
  try {
    var range = getSearchDateRange_(dateStr, 2)
    var query =
      'from:' +
      senderEmail +
      ' after:' +
      range.after +
      ' before:' +
      range.before
    var threads = GmailApp.search(query, 0, 10)
    var normDamaged = damagedSubject.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (!normDamaged) return null

    for (var t = 0; t < threads.length; t++) {
      var messages = threads[t].getMessages()
      for (var m = 0; m < messages.length; m++) {
        var msg = messages[m]
        var realSub = msg.getSubject()
        var normReal = realSub.toLowerCase().replace(/[^a-z0-9]/g, '')
        if (
          normReal === normDamaged ||
          (normDamaged.length > 8 &&
            (normReal.indexOf(normDamaged) !== -1 ||
              normDamaged.indexOf(normReal) !== -1))
        ) {
          return {
            subject: realSub,
            from: msg.getFrom(),
          }
        }
      }
    }
  } catch (e) {
    console.warn('[searchGmailForOriginalHeader_] Search error: ' + e.message)
  }
  return null
}

/**
 * Fetches file content and SHA from GitHub REST API.
 */
function fetchGitHubFileContent_(filePath, token) {
  var url =
    'https://api.github.com/repos/don-petry/self-private/contents/' + filePath
  var options = {
    method: 'get',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'GoogleAppsScript-Ingester',
    },
    muteHttpExceptions: true,
  }
  var res = UrlFetchApp.fetch(url, options)
  if (res.getResponseCode() === 200) {
    var data = JSON.parse(res.getContentText())
    var rawContent = Utilities.newBlob(
      Utilities.base64Decode(data.content)
    ).getDataAsString()
    return { content: rawContent, sha: data.sha }
  }
  return null
}

/**
 * Commits updated file content to GitHub REST API.
 */
function commitGitHubFileDirect_(
  filePath,
  updatedContent,
  sha,
  commitMessage,
  token
) {
  var url =
    'https://api.github.com/repos/don-petry/self-private/contents/' + filePath
  var encoded = Utilities.base64Encode(
    Utilities.newBlob(updatedContent).getBytes()
  )
  var payload = {
    message: commitMessage,
    content: encoded,
    sha: sha,
  }
  var options = {
    method: 'put',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'GoogleAppsScript-Ingester',
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  }
  var res = UrlFetchApp.fetch(url, options)
  return res.getResponseCode() === 200 || res.getResponseCode() === 201
}

/**
 * One-time backfill helper that queries Gmail to restore exact original UTF-8
 * Subject and From headers for historical activity log entries that were flattened to '?'.
 */
function backfillOriginalEmailHeaders() {
  console.log(
    '[backfillOriginalEmailHeaders] Starting historical header restoration from Gmail...'
  )
  var config = getAiClassifierConfig()
  if (!config.githubToken) {
    console.error('[backfillOriginalEmailHeaders] GITHUB_PAT is missing.')
    return
  }

  var targetFiles = [
    'petry-household/finances/index.md',
    'helpingoneguy/organization/organization/index.md',
    'petry-household/kids/index.md',
    'petry-household/birmingham/index.md',
    'petry-household/our-technology/digital-backups/index.md',
    'petry-household/vehicles/index.md',
    'dp-work-notes/notes/index.md',
  ]

  var totalRestored = 0

  for (var f = 0; f < targetFiles.length; f++) {
    var filePath = targetFiles[f]
    console.log('[backfillOriginalEmailHeaders] Processing: ' + filePath)

    var fileData = fetchGitHubFileContent_(filePath, config.githubToken)
    if (!fileData) {
      console.log(
        '[backfillOriginalEmailHeaders] File not found or empty: ' + filePath
      )
      continue
    }

    var lines = fileData.content.split('\n')
    var modified = false
    var fileRestoredCount = 0
    var currentDate = null

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i]
      var dateMatch = line.match(/^#{2,4} (\d{4}-\d{2}-\d{2})/)
      if (dateMatch) {
        currentDate = dateMatch[1]
        continue
      }

      if (
        line.indexOf('- **Subject**:') === 0 &&
        line.indexOf('?') !== -1 &&
        currentDate
      ) {
        var damagedSubject = line.substring('- **Subject**: '.length).trim()

        var fromLine = ''
        for (
          var j = Math.max(0, i - 3);
          j <= Math.min(lines.length - 1, i + 3);
          j++
        ) {
          if (lines[j].indexOf('- **From**:') === 0) {
            fromLine = lines[j].substring('- **From**: '.length).trim()
            break
          }
        }

        var senderEmail = ''
        var emailMatch = fromLine.match(/<([^>]+)>/)
        if (emailMatch) {
          senderEmail = emailMatch[1]
        } else if (fromLine.indexOf('@') !== -1) {
          senderEmail = fromLine
        }

        if (senderEmail) {
          var realEmail = searchGmailForOriginalHeader_(
            senderEmail,
            currentDate,
            damagedSubject
          )
          if (realEmail && realEmail.subject) {
            console.log(
              '[backfillOriginalEmailHeaders] Restoring: "' +
                damagedSubject +
                '" -> "' +
                realEmail.subject +
                '"'
            )
            lines[i] = '- **Subject**: ' + realEmail.subject
            modified = true
            fileRestoredCount++
            totalRestored++

            for (
              var k = Math.max(0, i - 3);
              k <= Math.min(lines.length - 1, i + 3);
              k++
            ) {
              if (
                lines[k].indexOf('- **From**:') === 0 &&
                lines[k].indexOf('?') !== -1 &&
                realEmail.from
              ) {
                lines[k] = '- **From**: ' + realEmail.from
                break
              }
            }
          }
        }
      }
    }

    if (modified) {
      var newContent = lines.join('\n')
      var commitMsg =
        'chore(notes): restore ' +
        fileRestoredCount +
        ' original Gmail headers in ' +
        filePath
      commitGitHubFileDirect_(
        filePath,
        newContent,
        fileData.sha,
        commitMsg,
        config.githubToken
      )
      console.log(
        '[backfillOriginalEmailHeaders] Successfully updated ' +
          filePath +
          ' (' +
          fileRestoredCount +
          ' headers restored).'
      )
    } else {
      console.log(
        '[backfillOriginalEmailHeaders] No damaged headers to restore in ' +
          filePath
      )
    }
  }

  console.log(
    '[backfillOriginalEmailHeaders] Finished header restoration. Total headers restored: ' +
      totalRestored
  )
}

/**
 * Retroactively scans and removes conflicting labels from threads in Gmail.
 * Resolves multi-label collisions like "Family/DJ & Rachel" appearing on project/domain threads,
 * and fixes Honey BeeHam threads that were tagged with "07_Community_NonProfit".
 */
function cleanupLegacyConflictingLabelsInGmail() {
  console.log(
    '[cleanupLegacyConflictingLabelsInGmail] Starting batch label cleanup...'
  )
  var djRachelLabel = GmailApp.getUserLabelByName('Family/DJ & Rachel')
  var nonProfitLabel = GmailApp.getUserLabelByName('07_Community_NonProfit')
  var beekeepingLabel = GmailApp.getUserLabelByName('Projects/Beekeeping')
  var honeyBeeHamLabel = ensureUserLabel('Projects/HoneyBeeHam')
  var householdLabel = ensureUserLabel('01_Household')

  var queries = [
    'label:"Family/DJ & Rachel" label:"07_Community_NonProfit"',
    'label:"Family/DJ & Rachel" label:"Projects/Beekeeping"',
    'label:"Family/DJ & Rachel" label:"Projects/HoneyBeeHam"',
    'label:"07_Community_NonProfit" label:"Projects/HoneyBeeHam"',
    'label:"Projects/Beekeeping" label:"Projects/HoneyBeeHam"',
    'from:honey4beeham@gmail.com label:"07_Community_NonProfit"',
    'label:"Retention/Permanent"',
    'label:"Family/DJ-Rachel"',
  ]

  var permRetLabel = GmailApp.getUserLabelByName('Retention/Permanent')
  var djRachelDashLabel = GmailApp.getUserLabelByName('Family/DJ-Rachel')
  var djRachelAmpLabel = ensureUserLabel('Family/DJ & Rachel')

  var cleanedCount = 0

  for (var q = 0; q < queries.length; q++) {
    var queryStr = queries[q]
    var threads = GmailApp.search(queryStr, 0, 50)
    console.log(
      '[cleanupLegacyConflictingLabelsInGmail] Query "' +
        queryStr +
        '": found ' +
        threads.length +
        ' thread(s)'
    )

    for (var i = 0; i < threads.length; i++) {
      var thread = threads[i]
      var subject = thread.getFirstMessageSubject() || ''
      var messages = thread.getMessages()
      var from = messages.length > 0 ? messages[0].getFrom() || '' : ''

      if (queryStr === 'label:"Retention/Permanent"') {
        if (permRetLabel) {
          thread.removeLabel(permRetLabel)
          console.log(
            '[cleanupLegacyConflictingLabelsInGmail] Stripped Retention/Permanent: ' +
              subject
          )
        }
      } else if (queryStr === 'label:"Family/DJ-Rachel"') {
        if (djRachelDashLabel) thread.removeLabel(djRachelDashLabel)
        thread.addLabel(djRachelAmpLabel)
        console.log(
          '[cleanupLegacyConflictingLabelsInGmail] Realigned Family/DJ-Rachel -> Family/DJ & Rachel: ' +
            subject
        )
      } else {
        var isHoneyBeeHam =
          /honey|beeham|candle|beeswax|made market|pepper place|coffee fest|thecarycompany/i.test(
            subject + ' ' + from
          )

        if (isHoneyBeeHam) {
          if (djRachelLabel) thread.removeLabel(djRachelLabel)
          if (nonProfitLabel) thread.removeLabel(nonProfitLabel)
          if (beekeepingLabel) thread.removeLabel(beekeepingLabel)
          thread.addLabel(householdLabel)
          thread.addLabel(honeyBeeHamLabel)
          console.log(
            '[cleanupLegacyConflictingLabelsInGmail] Realigned HoneyBeeHam thread: ' +
              subject
          )
        } else {
          if (djRachelLabel) thread.removeLabel(djRachelLabel)
          console.log(
            '[cleanupLegacyConflictingLabelsInGmail] Stripped redundant Family/DJ & Rachel: ' +
              subject
          )
        }
      }
      cleanedCount++
    }
  }

  // Final pass: Clean any legacy flat labels from recently active threads
  var flatLabels = [
    'Finance',
    'Household',
    'Family',
    'Projects',
    'Work',
    'Purchases',
    'Banking',
    'Bills',
    'eBills',
    'Insurance',
  ]
  for (var fl = 0; fl < flatLabels.length; fl++) {
    var fLabel = GmailApp.getUserLabelByName(flatLabels[fl])
    if (fLabel) {
      var fThreads = GmailApp.search('label:"' + flatLabels[fl] + '"', 0, 50)
      for (var ft = 0; ft < fThreads.length; ft++) {
        fThreads[ft].removeLabel(fLabel)
        cleanedCount++
      }
      console.log(
        '[cleanupLegacyConflictingLabelsInGmail] Stripped flat label "' +
          flatLabels[fl] +
          '" from ' +
          fThreads.length +
          ' thread(s).'
      )
    }
  }

  console.log(
    '[cleanupLegacyConflictingLabelsInGmail] Completed cleanup. Total threads updated: ' +
      cleanedCount
  )
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    processEmailsWithAiClassifier: processEmailsWithAiClassifier,
    purgeExpiredEmailsByRetentionPolicy: purgeExpiredEmailsByRetentionPolicy,
    setupWeeklyRetentionTrigger: setupWeeklyRetentionTrigger,
    setupFiveMinuteTrigger: setupFiveMinuteTrigger,
    stopAllTriggers: stopAllTriggers,
    classifyWithGemini: classifyWithGemini,
    ensureUserLabel: ensureUserLabel,
    createGmailFilterRule: createGmailFilterRule,
    backfillOriginalEmailHeaders: backfillOriginalEmailHeaders,
    getSearchDateRange_: getSearchDateRange_,
    searchGmailForOriginalHeader_: searchGmailForOriginalHeader_,
    cleanConflictingLabels: cleanConflictingLabels,
    cleanupLegacyConflictingLabelsInGmail:
      cleanupLegacyConflictingLabelsInGmail,
  }
}
