/**
 * Gmail AI Classifier — testable core logic.
 * All GAS services are injected as parameters so this module can be unit-tested
 * with Jest without a live Google Apps Script environment.
 */

/**
 * Validates a Gemini classification response object.
 *
 * Returns true only when the response has all required fields with values
 * within expected bounds and the label matches a configured canonical domain.
 *
 * @param {Object} classification - Parsed response from Gemini
 * @param {string[]} [canonicalDomains] - Allowed label values; omit to skip label check
 * @returns {boolean}
 */
function validateClassification(classification, canonicalDomains) {
  if (!classification || typeof classification !== 'object') return false
  if (
    !classification.canonical_label ||
    typeof classification.canonical_label !== 'string'
  )
    return false
  if (typeof classification.confidence !== 'number') return false
  if (classification.confidence < 0 || classification.confidence > 1)
    return false
  if (
    canonicalDomains &&
    !canonicalDomains.includes(classification.canonical_label)
  )
    return false
  return true
}

/**
 * Calls the Gemini REST API and returns a validated classification object, or null.
 *
 * Returns null on network errors, malformed responses, refused responses, or
 * responses whose canonical_label does not match a configured domain.
 *
 * @param {Object} config - Classifier configuration (modelEndpoint, geminiApiKey, canonicalDomains)
 * @param {string} sender - Email sender address
 * @param {string} subject - Email subject line
 * @param {string} bodyText - Plain-text body snippet (max 1,200 chars recommended)
 * @param {Object} urlFetchApp - GAS UrlFetchApp service (injected for testability)
 * @returns {Object|null} Validated classification or null
 */
function classifyEmailWithGemini(
  config,
  sender,
  subject,
  bodyText,
  urlFetchApp
) {
  var url = config.modelEndpoint + '?key=' + config.geminiApiKey

  var prompt =
    'You are an executive email classifier.\n' +
    'Classify the following email into exactly ONE of these canonical domain labels:\n' +
    config.canonicalDomains.join('\n') +
    '\n\n' +
    'Email Details:\n' +
    'Sender: ' +
    sender +
    '\n' +
    'Subject: ' +
    subject +
    '\n' +
    'Body Snippet: ' +
    bodyText +
    '\n\n' +
    'Respond ONLY in JSON format with these exact fields:\n' +
    '{"canonical_label": "<one of the labels above>", "confidence": <0.0-1.0>, "reasoning": "<one sentence>"}'

  var payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { response_mime_type: 'application/json' },
  }

  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  }

  try {
    var response = urlFetchApp.fetch(url, options)
    var jsonText = response.getContentText()
    var parsed = JSON.parse(jsonText)
    var outputText = parsed.candidates[0].content.parts[0].text
    var classification = JSON.parse(outputText)
    if (!validateClassification(classification, config.canonicalDomains)) {
      console.error(
        '[classifyEmailWithGemini] Invalid classification response:',
        JSON.stringify(classification)
      )
      return null
    }
    return classification
  } catch (e) {
    console.error(
      '[classifyEmailWithGemini] Error calling Gemini REST API:',
      e.message
    )
    return null
  }
}

/**
 * Ensures a Gmail user label exists, creating it if necessary.
 *
 * @param {string} labelName - Full label name (e.g. "01_Household/Primary")
 * @param {Object} gmailApp - GAS GmailApp service (injected for testability)
 * @returns {Object|null} GmailLabel or null on failure
 */
function ensureGmailLabel(labelName, gmailApp) {
  var existing = gmailApp.getUserLabelByName(labelName)
  if (existing) return existing
  try {
    return gmailApp.createLabel(labelName)
  } catch (e) {
    console.error(
      '[ensureGmailLabel] Error creating label:',
      labelName,
      e.message
    )
    return null
  }
}

/**
 * Creates a permanent Gmail filter rule mapping a sender address to a label.
 *
 * Returns true if the filter was created, false if the Advanced Gmail Service
 * was unavailable or creation failed.
 *
 * @param {string} senderEmail - Sender address (raw, may include display name)
 * @param {string} labelName - Target canonical label name
 * @param {Object|null} gmailService - GAS Gmail advanced service (injected; may be null)
 * @param {Object} gmailApp - GAS GmailApp service (injected for testability)
 * @returns {boolean}
 */
function createPermanentGmailFilter(
  senderEmail,
  labelName,
  gmailService,
  gmailApp
) {
  var cleanSender = senderEmail.replace(/.*<(.+)>/, '$1').trim()
  var targetLabel = ensureGmailLabel(labelName, gmailApp)
  if (!targetLabel) return false

  var filterBody = {
    criteria: { from: cleanSender },
    action: { addLabelIds: [targetLabel.getId()] },
  }

  try {
    if (
      gmailService &&
      gmailService.Users &&
      gmailService.Users.Settings &&
      gmailService.Users.Settings.Filters
    ) {
      gmailService.Users.Settings.Filters.create(filterBody, 'me')
      console.log(
        '[createPermanentGmailFilter] Permanent filter created:',
        cleanSender,
        '->',
        labelName
      )
      return true
    }
    console.log(
      '[createPermanentGmailFilter] Advanced Gmail service not enabled. Skipped.'
    )
    return false
  } catch (e) {
    console.error(
      '[createPermanentGmailFilter] Error creating filter:',
      e.message
    )
    return false
  }
}

/**
 * Processes a batch of Gmail threads: classify, label, and optionally create filters.
 *
 * @param {Object[]} threads - Array of GmailThread objects
 * @param {Object} config - Classifier configuration
 * @param {Object} services - Injected GAS services: { GmailApp, UrlFetchApp, Gmail }
 * @returns {Object[]} Array of result objects describing outcome per thread
 */
function processThreadBatch(threads, config, services) {
  var processedLabel = ensureGmailLabel(
    config.processedLabel,
    services.GmailApp
  )
  var results = []

  threads.forEach(function (thread) {
    var messages = thread.getMessages()
    if (!messages || messages.length === 0) {
      results.push({ threadId: thread.getId(), status: 'empty' })
      return
    }

    var latestMsg = messages[messages.length - 1]
    var sender = latestMsg.getFrom()
    var subject = latestMsg.getSubject()
    var bodySnippet = latestMsg.getPlainBody()
      ? latestMsg.getPlainBody().substring(0, 1200)
      : ''

    var classification = classifyEmailWithGemini(
      config,
      sender,
      subject,
      bodySnippet,
      services.UrlFetchApp
    )
    if (!classification) {
      console.log(
        '[processThreadBatch] Could not classify thread:',
        thread.getId()
      )
      results.push({ threadId: thread.getId(), status: 'unclassified' })
      return
    }

    console.log(
      '[processThreadBatch] Classified as:',
      classification.canonical_label,
      '(Confidence:',
      classification.confidence,
      ')'
    )

    var categoryLabel = ensureGmailLabel(
      classification.canonical_label,
      services.GmailApp
    )
    if (categoryLabel) thread.addLabel(categoryLabel)
    if (processedLabel) thread.addLabel(processedLabel)

    var filterCreated = false
    if (classification.confidence >= config.autoFilterConfidenceThreshold) {
      filterCreated = createPermanentGmailFilter(
        sender,
        classification.canonical_label,
        services.Gmail,
        services.GmailApp
      )
    }

    results.push({
      threadId: thread.getId(),
      status: 'classified',
      label: classification.canonical_label,
      confidence: classification.confidence,
      filterCreated: filterCreated,
    })
  })

  return results
}

module.exports = {
  validateClassification,
  classifyEmailWithGemini,
  ensureGmailLabel,
  createPermanentGmailFilter,
  processThreadBatch,
}
