/**
 * Main entry point for Gemini AI-Powered Semantic Email Classification and Auto-Filter Engine.
 * Runs natively inside Google Apps Script (V8 runtime).
 */

var GMAIL_AI_CLASSIFIER_VERSION = 'v1.7.0-strict-single-label-no-autofilters'

function remediateUnlabeledUtilityThreads() {
  try {
    var query =
      'water OR "water works" OR bwwb OR "caw-al.gov" OR "Central Alabama Water" OR "Funding Account Details"'
    var threads = GmailApp.search(query, 0, 15)
    console.log(
      '[remediateUnlabeledUtilityThreads] Found ' +
        threads.length +
        ' candidate thread(s).'
    )

    var targetSubLabel = 'Finance/Banking'
    var targetDomain = '02_Finance_Legal'
    var remediatedCount = 0

    for (var i = 0; i < threads.length; i++) {
      var t = threads[i]
      var labels = t.getLabels().map(function (l) {
        return l.getName()
      })

      var hasDomain = labels.indexOf(targetDomain) !== -1
      var hasSubLabel =
        labels.indexOf('Finance/Banking') !== -1 ||
        labels.indexOf('Finance/Bills') !== -1

      // If thread already carries the core domain or appropriate sub-label, skip
      if (hasDomain || hasSubLabel) {
        continue
      }

      console.log(
        '[remediateUnlabeledUtilityThreads] Remediating utility thread missing domain label: ' +
          t.getFirstMessageSubject()
      )
      var labelObj = ensureUserLabel(targetSubLabel)
      t.addLabel(labelObj)
      setGmailCategoryTab(t, 'Updates')
      remediatedCount++
    }

    console.log(
      '[remediateUnlabeledUtilityThreads] Successfully remediated ' +
        remediatedCount +
        ' thread(s).'
    )
  } catch (e) {
    console.error('[remediateUnlabeledUtilityThreads] Error: ' + e.message)
  }
}

function processEmailsWithAiClassifier() {
  console.log(
    '[processEmailsWithAiClassifier] Engine Version: ' +
      GMAIL_AI_CLASSIFIER_VERSION
  )
  remediateUnlabeledUtilityThreads()
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
      // Confidence Shield: destructive actions (trash/archive move mail out of
      // the Inbox) must only run on a well-formed, high-confidence response.
      // A malformed or manipulated Gemini payload (missing/low confidence,
      // unknown action verb) can NEVER trash or hide mail — it falls through and
      // the thread is preserved in the Inbox.
      var requestedDestructive =
        classification.action === 'trash' || classification.action === 'archive'
      var destructiveOk = isDestructiveActionAllowed_(classification)
      if (userSent && requestedDestructive) {
        console.log(
          '[processEmailsWithAiClassifier] Shield: Preserved thread in INBOX because user sent/replied to it.'
        )
      } else if (requestedDestructive && !destructiveOk) {
        console.warn(
          '[processEmailsWithAiClassifier] Shield: Skipped destructive action "' +
            classification.action +
            '" (low/invalid confidence ' +
            classification.confidence +
            '); preserved thread in INBOX.'
        )
      } else if (requestedDestructive) {
        if (classification.action === 'trash') {
          thread.moveToTrash()
          console.log(
            '[processEmailsWithAiClassifier] Action: Moved spam/unwanted thread to TRASH.'
          )
        } else {
          thread.moveToArchive()
          console.log(
            '[processEmailsWithAiClassifier] Action: Archived thread out of INBOX.'
          )
        }
      }

      if (classification.action === 'mark_read' || classification.markRead) {
        thread.markRead()
        console.log(
          '[processEmailsWithAiClassifier] Action: Marked thread as READ.'
        )
      }

      // 3. Category Tab Shifting (Path B: Push to Updates/Promotions/Social/Primary)
      if (
        classification.category &&
        classification.action !== 'archive' &&
        classification.action !== 'trash'
      ) {
        setGmailCategoryTab(thread, classification.category)
      }

      // Apply Single Global Processed Label (preserves INBOX visibility unless trashed/archived)
      thread.addLabel(processedLabel)
    } else {
      console.warn(
        '[processEmailsWithAiClassifier] Classification failed or returned null; preserving thread unprocessed for retry.'
      )
    }

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
        thread.removeLabel(lObj)
        console.log(
          '[cleanConflictingLabels] Removed conflicting sub-label: ' + lName
        )
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
    // OR any classifier sub-label. Under the strict single-label model a saved
    // core thread often carries ONLY its sub-label (e.g. "Finance/Banking") with
    // the canonical-domain code stripped, so exempting canonical codes alone
    // would let the 2-year purge trash indefinitely-retained core mail. Any
    // user sub-label (contains '/', excluding the ephemeral Retention/* tags)
    // therefore also grants exemption.
    for (var l = 0; l < labels.length; l++) {
      var labelName = labels[l].getName()
      for (var cd = 0; cd < coreDomainLabels.length; cd++) {
        if (labelName.indexOf(coreDomainLabels[cd]) !== -1) {
          isExempt = true
          break
        }
      }
      if (isExempt) break
      if (
        labelName.indexOf('/') !== -1 &&
        labelName.indexOf('Retention/') !== 0
      ) {
        isExempt = true
        break
      }
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
    // userEmail is pre-computed once by the caller from config.userAccountEmail.
    // Never call Session.getEffectiveUser().getEmail() here: this function runs
    // inside per-thread loops (processEmailsWithAiClassifier, retention purge),
    // so re-fetching the static owner email would be an expensive API call per
    // iteration.
    var primaryEmail = (userEmail || '').toLowerCase()
    if (!primaryEmail) {
      return false
    }
    var messages = thread.getMessages()
    for (var m = 0; m < messages.length; m++) {
      var fromAddr = messages[m].getFrom().toLowerCase()
      if (fromAddr.indexOf(primaryEmail) !== -1) {
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
 * Guards destructive actions (trash/archive) behind a strict validation of the
 * parsed Gemini response. Returns true only when the action is a recognized
 * destructive verb AND the response carries a finite confidence at or above the
 * destructive-action minimum. Any malformed, manipulated, or low-confidence
 * response returns false so the thread is preserved in the Inbox.
 */
var DESTRUCTIVE_CONFIDENCE_MIN = 0.85

function isDestructiveActionAllowed_(classification) {
  if (!classification || typeof classification !== 'object') {
    return false
  }
  if (
    classification.action !== 'trash' &&
    classification.action !== 'archive'
  ) {
    return false
  }
  var confidence = classification.confidence
  if (typeof confidence !== 'number' || !isFinite(confidence)) {
    return false
  }
  return confidence >= DESTRUCTIVE_CONFIDENCE_MIN
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
 * Sets up a daily cloud trigger to run auditEmailClassifications every morning at 6:00 AM.
 */
function setupDailyAuditTrigger() {
  var triggers = ScriptApp.getProjectTriggers()
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'auditEmailClassifications') {
      ScriptApp.deleteTrigger(triggers[i])
    }
  }

  ScriptApp.newTrigger('auditEmailClassifications')
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .create()

  console.log(
    '[setupDailyAuditTrigger] Established daily 6:00 AM classification audit trigger.'
  )
}

/**
 * Daily audit routine that inspects recently processed threads for classification anomalies,
 * missing or duplicate domain labels, and potential prompt tuning opportunities.
 * Logs anomalies to console and optionally emails a digest if AUDIT_DIGEST_EMAIL is configured.
 */
function auditEmailClassifications() {
  console.log(
    '[auditEmailClassifications] Starting daily classification audit sweep...'
  )
  var config = getAiClassifierConfig()
  var lookback = config.auditLookbackDays || 2
  var query = 'label:' + config.processedLabel + ' newer_than:' + lookback + 'd'

  var threads = GmailApp.search(query, 0, 50)
  console.log(
    '[auditEmailClassifications] Found ' +
      threads.length +
      ' processed thread(s) in last ' +
      lookback +
      ' day(s).'
  )

  var report = auditClassifications(threads, config)
  console.log('[auditEmailClassifications] ' + report.summary)

  if (report.flaggedCount > 0) {
    var digest = formatAuditDigest(report)
    console.warn('[auditEmailClassifications] Anomalies detected:\n' + digest)

    if (config.auditDigestEmail) {
      try {
        GmailApp.sendEmail(
          config.auditDigestEmail,
          '[Gmail AI Classifier] Daily Classification Audit: ' +
            report.flaggedCount +
            ' anomalies detected',
          digest
        )
        console.log(
          '[auditEmailClassifications] Audit digest email sent to ' +
            config.auditDigestEmail
        )
      } catch (e) {
        console.error(
          '[auditEmailClassifications] Failed to send audit digest email:',
          e.message
        )
      }
    }
  } else {
    console.log(
      '[auditEmailClassifications] All analyzed threads are compliant with taxonomy rules.'
    )
  }

  return report
}

/**
 * Audits a collection of processed Gmail threads for classification anomalies.
 *
 * @param {Array} threads - Array of GmailThread-like objects
 * @param {Object} config - Classifier config
 * @returns {Object} report - { scannedCount, flaggedCount, findings, summary }
 */
function auditClassifications(threads, config) {
  var canonicalDomains = (config && config.canonicalDomains) || [
    '01_Household',
    '02_Finance_Legal',
    '03_Vehicles',
    '04_Family_Health',
    '05_Tech_Infrastructure',
    '06_Work_Career',
    '07_Community_NonProfit',
  ]

  var PROMO_KEYWORDS =
    /\b(sale|\d+% off|deal of the day|clearance|limited time offer|coupon|shop now)\b/i
  var NEWSLETTER_KEYWORDS =
    /\b(weekly digest|daily digest|newsletter|roundup|top stories)\b/i
  var ORDER_KEYWORDS =
    /\b(order confirmation|your order|receipt|payment received|invoice|shipped)\b/i

  var findings = []

  if (!Array.isArray(threads)) {
    return {
      scannedCount: 0,
      flaggedCount: 0,
      findings: [],
      summary: 'No threads to audit.',
    }
  }

  threads.forEach(function (thread) {
    if (!thread) return
    var id =
      typeof thread.getId === 'function' ? thread.getId() : thread.id || ''
    var subject =
      typeof thread.getFirstMessageSubject === 'function'
        ? thread.getFirstMessageSubject()
        : thread.subject || ''

    var sender = ''
    if (typeof thread.getMessages === 'function') {
      var msgs = thread.getMessages()
      if (msgs && msgs.length > 0 && typeof msgs[0].getFrom === 'function') {
        sender = msgs[0].getFrom()
      }
    } else if (thread.sender) {
      sender = thread.sender
    }

    var rawLabels = []
    if (typeof thread.getLabels === 'function') {
      var labelObjs = thread.getLabels() || []
      rawLabels = labelObjs.map(function (l) {
        return typeof l.getName === 'function' ? l.getName() : String(l)
      })
    } else if (Array.isArray(thread.labels)) {
      rawLabels = thread.labels
    }

    var assignedCanonical = rawLabels.filter(function (l) {
      return canonicalDomains.indexOf(l) !== -1 || /^0[1-7]_/.test(l)
    })
    var flags = []

    // 1. Missing Domain
    if (assignedCanonical.length === 0) {
      flags.push(
        'MISSING_CANONICAL_DOMAIN: Thread marked as processed has no canonical domain label.'
      )
    }

    // 2. Conflicting Domains
    if (assignedCanonical.length > 1) {
      flags.push(
        'CONFLICTING_DOMAINS: Multiple canonical domain labels assigned: ' +
          assignedCanonical.join(', ')
      )
    }

    // 3. Heuristic Checks
    var fullText = (subject + ' ' + sender).toLowerCase()
    if (ORDER_KEYWORDS.test(fullText)) {
      var hasFinanceOrHousehold = assignedCanonical.some(function (l) {
        return (
          l.indexOf('02_Finance_Legal') !== -1 ||
          l.indexOf('01_Household') !== -1 ||
          l.indexOf('03_Vehicles') !== -1
        )
      })
      if (assignedCanonical.length > 0 && !hasFinanceOrHousehold) {
        flags.push(
          'SUSPICIOUS_ROUTING: Purchase/receipt keywords detected but domain is ' +
            assignedCanonical.join(', ') +
            ' instead of 02_Finance_Legal.'
        )
      }
    }

    if (PROMO_KEYWORDS.test(subject) && assignedCanonical.length > 0) {
      var hasMarketingSublabel = rawLabels.some(function (l) {
        return /promo|marketing|deal|coupon/i.test(l)
      })
      if (!hasMarketingSublabel) {
        flags.push(
          'PROMOTIONAL_CONTENT: Promotional sale keywords in subject tagged under core domain ' +
            assignedCanonical.join(', ') +
            ' without marketing sub-label.'
        )
      }
    }

    if (NEWSLETTER_KEYWORDS.test(subject) && assignedCanonical.length > 0) {
      var hasNewsletterSublabel = rawLabels.some(function (l) {
        return /newsletter|digest|news/i.test(l)
      })
      if (!hasNewsletterSublabel) {
        flags.push(
          'UNLABELED_NEWSLETTER: Generic newsletter/digest subject tagged under core domain ' +
            assignedCanonical.join(', ') +
            ' without newsletter sub-label.'
        )
      }
    }

    if (flags.length > 0) {
      findings.push({
        threadId: id,
        subject: subject,
        sender: sender,
        canonicalLabels: assignedCanonical,
        allLabels: rawLabels,
        flags: flags,
      })
    }
  })

  return {
    scannedCount: threads.length,
    flaggedCount: findings.length,
    findings: findings,
    summary:
      'Audited ' +
      threads.length +
      ' thread(s); ' +
      findings.length +
      ' anomaly flag(s) identified.',
  }
}

/**
 * Formats an audit report into a human-readable email digest or log message.
 *
 * @param {Object} report - Result from auditClassifications
 * @returns {string} Formatted digest text
 */
function formatAuditDigest(report) {
  if (!report || report.flaggedCount === 0) {
    return (
      'Gmail AI Classifier Audit: All ' +
      (report ? report.scannedCount : 0) +
      ' analyzed threads are compliant. No anomalies detected.'
    )
  }

  var text = '===================================================\n'
  text += '   GMAIL AI CLASSIFICATION AUDIT REPORT\n'
  text += '===================================================\n'
  text += report.summary + '\n\n'

  report.findings.forEach(function (finding, idx) {
    text +=
      idx + 1 + '. Subject: "' + (finding.subject || '(no subject)') + '"\n'
    text += '   Sender:  ' + (finding.sender || '(unknown)') + '\n'
    text +=
      '   Labels:  ' + (finding.canonicalLabels.join(', ') || '(none)') + '\n'
    text += '   Flags:\n'
    finding.flags.forEach(function (f) {
      text += '     • ' + f + '\n'
    })
    text += '\n'
  })

  text += '---------------------------------------------------\n'
  text +=
    'Tuning Action: Update ScriptProperty CUSTOM_PROMPT_RULES to add calibrated sender rules.\n'
  text += '===================================================\n'
  return text
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
  setupDailyAuditTrigger()
  console.log(
    '[setupFiveMinuteTrigger] Successfully established 5-minute recurring cloud trigger, weekly retention trigger, and daily audit trigger.'
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
    "1. MEDIA & PLATFORM NEWSLETTERS (Medium, Substack, LinkedIn digests, event/news blasts): Treat strictly as Promotional / Newsletter and return null for canonicalDomain. Do NOT classify under '06_Work_Career' or '04_Family_Health'. Set category to 'Promotions', action to 'archive'.\n" +
    "2. UTILITY & TECH BILLS & ACCOUNTS (Electric, Gas, Water, Internet, Phone, Cloud infrastructure, and utility payment/funding accounts): Classify all utility bills, statements, payment confirmations, and account/funding setup notices under '02_Finance_Legal' (or '05_Tech_Infrastructure' for tech cloud infrastructure). Use sub-label 'Finance/Bills' for statements, usage notices, and invoices; use 'Finance/Banking' for funding accounts, payment methods, bank linkages, autopay setups, and portal migration notices. CRITICAL TRIAGE: If the bill is due and requires manual payment / action (no auto-pay confirmed), set category to 'Primary', action to 'keep'. If auto-pay or funding confirmation is scheduled/active/confirmed, set category to 'Updates', action to 'archive'.\n" +
    "3. MARRIAGE & ADULT FAMILY (Personal correspondence, family retreats, marital planning): Classify under '04_Family_Health' (sub-label 'Family/Personal-Correspondence'). Set category to 'Primary', action to 'keep'.\n" +
    "4. NON-PROFIT CHARITY & VOLUNTEERING (501(c)(3) charity records, volunteer schedules, non-profit Board of Directors official communications, telemetry alerts): Classify strictly under '07_Community_NonProfit' (sub-labels 'Projects/Charity', 'Community/BOD', or 'Projects/Telemetry'). For volunteer shift reminders, set category to 'Updates', action to 'keep'. For general newsletters or recap blasts, set category to 'Updates', action to 'archive'.\n" +
    "5. HEALTH & MEDICAL (Personal family medical records, doctor visits, patient portals, hospital records, prescription notices): Classify under '04_Family_Health' (sub-label 'Family/Medical'). If prescription is ready or doctor appointment requires action, set category to 'Primary', action to 'keep'. For health newsletters (health blogs, drug recalls), treat as Newsletter (canonicalDomain: null, category: 'Promotions', action: 'archive').\n" +
    "6. E-COMMERCE PROMOTIONS & RETAIL DEALS (Retail coupons, store offers, e-commerce promotional discounts): Return null for canonicalDomain. Set category to 'Promotions', action to 'archive'.\n" +
    "7. SCHOOL PORTALS & STUDENT EDUCATION: Classify educational portals, student coursework, teacher updates, and school tuition/transportation invoices under '04_Family_Health' (sub-label 'Family/School-Student' or specific configured student label). If invoice/bill has auto-pay confirmed scheduled, set category to 'Updates', action to 'archive'. If bill requires manual payment or is a direct teacher/academic note, set category to 'Primary', action to 'keep'. If routine daily menu/lunch platform digest, set category to 'Updates', action to 'archive'.\n" +
    "8. TECH WEBINARS & PRODUCT MARKETING (Cloud webinars, 'Register Now', product marketing, tech promos): Treat as Promotional / Marketing and return null for canonicalDomain. Reserve '05_Tech_Infrastructure' strictly for active system alerts, security warnings, spend cap notifications, and project quota/outage alerts. Set category to 'Promotions', action to 'archive'.\n" +
    "9. HOBBY & STORE MARKETING (Commercial hobby stores, e-commerce store newsletters, product announcements): Treat as Promotional / Marketing and return null for canonicalDomain. Reserve '07_Community_NonProfit' strictly for active telemetry alerts and official non-profit communications. Set category to 'Promotions', action to 'archive'.\n" +
    "10. SPAM & PHISHING & UNWANTED SOLICITATION: Set action to 'trash'.\n" +
    "11. ROUTINE AUTHENTICATION & FINANCIAL TRANSFER NOTIFICATIONS (Login/SSO confirmations, linked funding/bank account setups, routine identity verifications, internal account transfers, automated git notifications): If routine successful sign-in, linked funding account, or transfer, classify under '02_Finance_Legal' (sub-label 'Finance/Banking') or '05_Tech_Infrastructure' and set category to 'Updates', action to 'archive'. If suspicious login alert or password reset, set category to 'Primary', action to 'keep'.\n" +
    "12. ORDER CONFIRMATIONS, SHIPMENTS & RECEIPTS (Order confirmations, purchase receipts, invoices, delivery confirmations): Classify under '02_Finance_Legal' (sub-label 'Finance/Purchases') or '01_Household' / '03_Vehicles'. While order is placed or in-transit, set category to 'Updates', action to 'keep'. When package is marked delivered or completed, set category to 'Updates', action to 'archive'.\n" +
    "13. SINGLE SUB-LABEL RULE: Return AT MOST ONE subLabel string per email (the single best matching sub-label, e.g. 'Finance/Banking' or 'Family/School-Student'). Do NOT stack multiple sub-labels.\n" +
    "14. UNSOLICITED REAL ESTATE & INVESTMENT SOLICITATION (Cold wholesaler property blasts, 'Off-Market Investment Opportunity', 'We Buy Houses', unsolicited real estate deal blasts): Treat as Promotional / Solicitation and return null for canonicalDomain. Do NOT classify under '02_Finance_Legal' or '01_Household'. Reserve '02_Finance_Legal' strictly for personal bank statements, mortgages, tax documents, credit cards, and active legal records. Set action to 'trash'.\n" +
    "15. SMALL BUSINESS, ARTISANAL CRAFT & HOBBY SALES: Classify inventory orders, wholesale invoices, artisanal sales, market vendor receipts, and business compliance forms under '01_Household' (sub-label 'Projects/Business') or '02_Finance_Legal' (sub-label 'Finance/Purchases' if pure purchase receipt/invoice). Set category to 'Updates', action to 'keep'. Under NO circumstances classify business sales under '07_Community_NonProfit'!\n" +
    "16. TAX FORMS, CHARITABLE DONATIONS & COURT ORDERS (1095-C, 1098, W2, tax returns, tax agency notices, donation receipts, court orders, legal closing orders): Classify under '02_Finance_Legal' (sub-labels 'Finance/Taxes', 'Finance/Charitable-Donations', or 'Finance/Legal'). CRITICAL TRIAGE: If action-required tax notice or audit/response deadline, set category to 'Primary', action to 'keep'. For routine tax forms, annual reports, or charitable receipts, set category to 'Updates', action to 'keep'.\n" +
    "17. JOB POSTINGS, RESUMES & CAREER INTERVIEWS (Job announcements, interview schedules, recruiter messages, resume feedback): Classify under '06_Work_Career' (sub-label 'Work/Career'). Set category to 'Primary' or 'Updates', action to 'keep'.\n" +
    "18. CAR RENTALS & TRAVEL RESERVATION CONFIRMATIONS (Car rentals, airline flights, hotel reservations, travel check-ins): Classify under '01_Household' (sub-label 'Household/Travel') or '03_Vehicles' (sub-label 'Vehicles/Rental-Cars'). Set category to 'Updates', action to 'keep'.\n\n"

  if (config.customPromptRules) {
    prompt += 'USER CUSTOM DOMAIN RULES:\n' + config.customPromptRules + '\n\n'
  }

  prompt +=
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
  var map = {
    '01_Household': 'household/primary/index.md',
    '02_Finance_Legal': 'household/finances/index.md',
    '03_Vehicles': 'household/vehicles/index.md',
    '04_Family_Health': 'household/kids/index.md',
    '05_Tech_Infrastructure': 'household/technology/index.md',
    '06_Work_Career': 'work/notes/index.md',
    '07_Community_NonProfit': 'community/organization/index.md',
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
 * Detects evidence of mojibake (UTF-8 flattened to '?') in a line, distinct from
 * a legitimate question mark. A standalone trailing '?' (e.g. "Ready?") is NOT
 * mojibake; a '?' inside a word, a spaced ' ? ' separator, a doubled '??', or a
 * U+FFFD replacement character is.
 */
function hasMojibakeMarker_(text) {
  if (!text) return false
  return (
    /\S \? \S/.test(text) ||
    /\?\?/.test(text) ||
    /[A-Za-z]\?[A-Za-z]/.test(text) ||
    /�/.test(text)
  )
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
    // Gmail search does not guarantee ordering; sort by last-message date
    // (newest first) so the closest matching thread is selected deterministically.
    threads.sort(function (a, b) {
      return b.getLastMessageDate() - a.getLastMessageDate()
    })
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
    'household/finances/index.md',
    'community/organization/index.md',
    'household/kids/index.md',
    'household/primary/index.md',
    'household/technology/index.md',
    'household/vehicles/index.md',
    'work/notes/index.md',
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
        hasMojibakeMarker_(line) &&
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
          if (
            realEmail &&
            realEmail.subject &&
            realEmail.subject !== damagedSubject &&
            /[^\x00-\x7F]/.test(realEmail.subject)
          ) {
            // Only restore when the Gmail subject differs from the flattened
            // value AND actually reintroduces non-ASCII content. This prevents a
            // legitimate subject like "Ready?" from being overwritten by a
            // similarly-named-but-different message ("Ready").
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
                hasMojibakeMarker_(lines[k]) &&
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
      var committed = commitGitHubFileDirect_(
        filePath,
        newContent,
        fileData.sha,
        commitMsg,
        config.githubToken
      )
      if (!committed) {
        console.error(
          '[backfillOriginalEmailHeaders] Failed to commit updates to ' +
            filePath +
            '; not counting ' +
            fileRestoredCount +
            ' header(s) as restored.'
        )
        totalRestored -= fileRestoredCount
        continue
      }
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
 * Sets the Gmail system category tab (Primary, Updates, Promotions, Social, Forums)
 * via the Advanced Gmail API.
 */
function setGmailCategoryTab(thread, targetCategory) {
  if (
    typeof Gmail === 'undefined' ||
    !Gmail.Users ||
    !Gmail.Users.Threads ||
    !Gmail.Users.Threads.modify
  ) {
    return
  }

  var catMap = {
    Primary: 'CATEGORY_PERSONAL',
    Updates: 'CATEGORY_UPDATES',
    Promotions: 'CATEGORY_PROMOTIONS',
    Social: 'CATEGORY_SOCIAL',
    Forums: 'CATEGORY_FORUMS',
  }

  var targetId = catMap[targetCategory]
  if (!targetId) return

  var allCategoryIds = [
    'CATEGORY_PERSONAL',
    'CATEGORY_UPDATES',
    'CATEGORY_PROMOTIONS',
    'CATEGORY_SOCIAL',
    'CATEGORY_FORUMS',
  ]

  var removeIds = allCategoryIds.filter(function (id) {
    return id !== targetId
  })

  try {
    Gmail.Users.Threads.modify(
      {
        addLabelIds: [targetId],
        removeLabelIds: removeIds,
      },
      'me',
      thread.getId()
    )
    console.log(
      '[setGmailCategoryTab] Assigned category ' +
        targetId +
        ' to thread: ' +
        thread.getFirstMessageSubject()
    )
  } catch (e) {
    console.warn(
      '[setGmailCategoryTab] Could not modify thread category: ' + e.message
    )
  }
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
    setGmailCategoryTab: setGmailCategoryTab,
  }
}
