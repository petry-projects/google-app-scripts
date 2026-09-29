/**
 * Gmail AI Classifier — testable core logic.
 * All GAS services are injected as parameters so this module can be unit-tested
 * with Jest without a live Google Apps Script environment.
 */

const { getFileHash } = require('../../gas-utils')

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
  if (!Number.isFinite(classification.confidence)) return false
  if (classification.confidence < 0 || classification.confidence > 1)
    return false
  if (
    classification.reasoning === undefined ||
    typeof classification.reasoning !== 'string'
  )
    return false
  if (
    canonicalDomains &&
    !canonicalDomains.includes(classification.canonical_label)
  )
    return false
  return true
}

function _sleep(ms) {
  if (typeof Utilities !== 'undefined') Utilities.sleep(ms)
}

/**
 * Calls the Gemini REST API and returns a validated classification object, or null.
 *
 * Returns null on network errors, malformed responses, refused responses, or
 * responses whose canonical_label does not match a configured domain.
 * Retries transient 429/5xx responses with exponential backoff (up to 3 attempts).
 *
 * @param {Object} config - Classifier configuration (modelEndpoint, geminiApiKey, canonicalDomains)
 * @param {string} sender - Email sender address
 * @param {string} subject - Email subject line
 * @param {string} bodyText - Plain-text body snippet (max 1,200 chars recommended)
 * @param {Object} urlFetchApp - GAS UrlFetchApp service (injected for testability)
 * @param {Function} [sleepFn] - Sleep function for retry delays (injected for testability, defaults to _sleep)
 * @returns {Object|null} Validated classification or null
 */
function classifyEmailWithGemini(
  config,
  sender,
  subject,
  bodyText,
  urlFetchApp,
  sleepFn
) {
  const url = config.modelEndpoint
  const sleep = sleepFn || _sleep

  const prompt =
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

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { response_mime_type: 'application/json' },
  }

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-goog-api-key': config.geminiApiKey,
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  }

  const MAX_ATTEMPTS = 3
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const response = urlFetchApp.fetch(url, options)
      const statusCode = response.getResponseCode()

      if (statusCode === 429 || (statusCode >= 500 && statusCode < 600)) {
        if (attempt < MAX_ATTEMPTS - 1) {
          sleep(Math.pow(2, attempt) * 1000)
          continue
        }
        console.error(
          '[classifyEmailWithGemini] Transient error after retries, status:',
          statusCode
        )
        return null
      }

      if (statusCode < 200 || statusCode >= 300) {
        console.error(
          '[classifyEmailWithGemini] HTTP error from Gemini API, status:',
          statusCode
        )
        return null
      }

      const jsonText = response.getContentText()
      const parsed = JSON.parse(jsonText)
      const outputText = parsed.candidates[0].content.parts[0].text
      const classification = JSON.parse(outputText)
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
}

/**
 * Ensures a Gmail user label exists, creating it if necessary.
 *
 * @param {string} labelName - Full label name (e.g. "01_Household/Primary")
 * @param {Object} gmailApp - GAS GmailApp service (injected for testability)
 * @returns {Object|null} GmailLabel or null on failure
 */
function ensureGmailLabel(labelName, gmailApp) {
  const existing = gmailApp.getUserLabelByName(labelName)
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
  const ltIdx = senderEmail.indexOf('<')
  const gtIdx = senderEmail.indexOf('>', ltIdx + 1)
  const cleanSender =
    ltIdx !== -1 && gtIdx !== -1
      ? senderEmail.slice(ltIdx + 1, gtIdx).trim()
      : senderEmail.trim()
  const targetLabel = ensureGmailLabel(labelName, gmailApp)
  if (!targetLabel) return false

  if (gmailService?.Users?.Settings?.Filters) {
    try {
      const existingFilters = gmailService.Users.Settings.Filters.list('me')
      if (existingFilters?.filter) {
        const duplicate = existingFilters.filter.some(function (f) {
          return f.criteria?.from === cleanSender
        })
        if (duplicate) {
          console.log(
            '[createPermanentGmailFilter] Filter already exists for label:',
            labelName
          )
          return true
        }
      }
    } catch (e) {
      console.error(
        '[createPermanentGmailFilter] Error checking existing filters:',
        e.message
      )
    }

    const filterBody = {
      criteria: { from: cleanSender },
      action: { addLabelIds: [targetLabel.getId()] },
    }

    try {
      gmailService.Users.Settings.Filters.create(filterBody, 'me')
      console.log(
        '[createPermanentGmailFilter] Permanent filter created for label:',
        labelName
      )
      return true
    } catch (e) {
      console.error(
        '[createPermanentGmailFilter] Error creating filter:',
        e.message
      )
      return false
    }
  }

  console.log(
    '[createPermanentGmailFilter] Advanced Gmail service not enabled. Skipped.'
  )
  return false
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
  const processedLabel = ensureGmailLabel(
    config.processedLabel,
    services.GmailApp
  )
  if (!processedLabel) {
    console.error(
      '[processThreadBatch] Processed label unavailable; aborting batch to avoid reprocessing.'
    )
    return []
  }
  const results = []

  threads.forEach(function (thread) {
    const messages = thread.getMessages()
    if (!messages || messages.length === 0) {
      results.push({ threadId: thread.getId(), status: 'empty' })
      return
    }

    const latestMsg = messages[0]
    const sender = latestMsg.getFrom()
    const subject = latestMsg.getSubject()
    const bodySnippet = latestMsg.getPlainBody()
      ? latestMsg.getPlainBody().substring(0, 1200)
      : ''

    const classification = classifyEmailWithGemini(
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

    const categoryLabel = ensureGmailLabel(
      classification.canonical_label,
      services.GmailApp
    )
    if (!categoryLabel) {
      console.error(
        '[processThreadBatch] Failed to create category label:',
        classification.canonical_label
      )
      results.push({
        threadId: thread.getId(),
        status: 'label_creation_failed',
      })
      return
    }
    thread.addLabel(categoryLabel)
    thread.addLabel(processedLabel)

    let filterCreated = false
    if (classification.confidence >= config.autoFilterConfidenceThreshold) {
      filterCreated = createPermanentGmailFilter(
        sender,
        classification.canonical_label,
        services.Gmail,
        services.GmailApp
      )
    }

    let savedAttachments = []
    if (services?.DriveApp) {
      savedAttachments = persistCanonicalAttachmentsToDrive(
        thread,
        classification,
        config,
        services
      )
    }

    results.push({
      threadId: thread.getId(),
      status: 'classified',
      label: classification.canonical_label,
      confidence: classification.confidence,
      filterCreated: filterCreated,
      savedAttachments: savedAttachments,
    })
  })

  return results
}

const GITHUB_REPO_OWNER = 'don-petry'
const GITHUB_REPO_NAME = 'self-private'

const RULE6_PATTERNS = [
  [/\S \? \S/, "' ? ' between words (was an em dash or a · separator)"],
  [/\?\?/, "'??' (was a multi-codepoint emoji)"],
  [/[A-Za-z]\?[A-Za-z]/, "'?' inside a word (was a curly apostrophe)"],
  [/\uFFFD/, 'U+FFFD replacement character'],
]

/** Refuse to write an entry that already shows mojibake. */
function assertClean_(text, what) {
  if (!text) return
  for (let i = 0; i < RULE6_PATTERNS.length; i++) {
    if (RULE6_PATTERNS[i][0].test(text)) {
      throw new Error(
        'Rule 6: refusing to write ' + what + ' — ' + RULE6_PATTERNS[i][1]
      )
    }
  }
}

/** Refuse to write when a non-ASCII char in the source text became '?' on the way out. */
function assertNoAsciiReplacement_(source, rendered) {
  if (!source || !rendered) return
  if (rendered.indexOf('?') === -1) return
  const lost = []
  for (let i = 0; i < source.length; i++) {
    const c = source.charAt(i)
    if (
      c.charCodeAt(0) > 127 &&
      rendered.indexOf(c) === -1 &&
      lost.indexOf(c) === -1
    ) {
      lost.push(c)
    }
  }
  if (lost.length) {
    throw new Error(
      'Rule 6: refusing to write text that flattened non-ASCII to "?": ' +
        lost.join(' ') +
        ' — encode as UTF-8, not ASCII.'
    )
  }
}

function extractTopicTitleFromPath(filePath) {
  const parts = filePath.split('/')
  const topic = parts.length > 1 ? parts[parts.length - 2] : parts[0]
  // Strip any trailing file extension (e.g. ".md") before title-casing so a
  // single-segment path like "digital-backups.md" becomes "Digital Backups".
  return topic
    .replace(/\.[^.]+$/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, function (l) {
      return l.toUpperCase()
    })
}

function insertEntryIntoLogSection(fullContent, newEntry) {
  const detailsMarker = '</details>'
  const detailsIndex = fullContent.indexOf(detailsMarker)

  if (detailsIndex !== -1) {
    return (
      fullContent.substring(0, detailsIndex) +
      newEntry +
      '\n' +
      fullContent.substring(detailsIndex)
    )
  }

  const section3Marker = '## 3. Ingested Activity'
  const section3Index = fullContent.indexOf(section3Marker)

  if (section3Index !== -1) {
    const lineBreakIndex = fullContent.indexOf('\n', section3Index)
    return (
      fullContent.substring(0, lineBreakIndex + 1) +
      newEntry +
      '\n' +
      fullContent.substring(lineBreakIndex + 1)
    )
  }

  return fullContent + '\n' + newEntry
}

function formatProgressiveDisclosureEntry(
  dateStr,
  title,
  sender,
  subject,
  summaryText,
  accountEmail,
  attachments
) {
  let entry = '\n### ' + dateStr + ' — ' + title + '\n'
  entry += '- **Account**: ' + accountEmail + '\n'
  entry += '- **From**: ' + sender + '\n'
  entry += '- **Subject**: ' + subject + '\n'
  if (summaryText) {
    entry += '- **Summary**:\n  > ' + summaryText.trim() + '\n'
  }
  if (attachments && attachments.length > 0) {
    entry += '- **Attachments**:\n'
    for (let a = 0; a < attachments.length; a++) {
      const att = attachments[a]
      if (att?.name) {
        if (att.url) {
          entry += '  - [' + att.name + '](' + att.url + ')\n'
        } else {
          entry += '  - ' + att.name + '\n'
        }
      }
    }
  }
  return entry
}

function getNotePathForDomain(domain, _subLabel) {
  const map = {
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

function appendMarkdownEntryToGitHubRepo(
  filePath,
  entryMd,
  commitMessage,
  services
) {
  const props =
    services?.PropertiesService ||
    (typeof PropertiesService !== 'undefined' ? PropertiesService : null)
  const githubToken = props?.getScriptProperties()?.getProperty('GITHUB_PAT')
  if (!githubToken) {
    console.log(
      '[gitHubSync] GITHUB_PAT ScriptProperty not set. Skipping GitHub commit.'
    )
    return false
  }

  const sleep = services?.sleepFn || _sleep
  const maxRetries = 3
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = executeGitHubCommit(
      filePath,
      entryMd,
      commitMessage,
      githubToken,
      services
    )
    if (result === true || result === 'IDEMPOTENT_SKIP') {
      return true
    }
    console.log(
      '[gitHubSync] Retry attempt',
      attempt,
      'of',
      maxRetries,
      'for',
      filePath
    )
    sleep(1000 * attempt)
  }

  console.error(
    '[gitHubSync] Failed to commit entry to GitHub after',
    maxRetries,
    'attempts:',
    filePath
  )
  return false
}

function executeGitHubCommit(
  filePath,
  entryMd,
  commitMessage,
  githubToken,
  services
) {
  const urlFetchApp =
    services?.UrlFetchApp ||
    (typeof UrlFetchApp !== 'undefined' ? UrlFetchApp : null)
  const utils =
    services?.Utilities || (typeof Utilities !== 'undefined' ? Utilities : null)

  const repoOwner =
    services?.githubRepoOwner ||
    process.env.GITHUB_REPO_OWNER ||
    GITHUB_REPO_OWNER
  const repoName =
    services?.githubRepoName || process.env.GITHUB_REPO_NAME || GITHUB_REPO_NAME

  const url =
    'https://api.github.com/repos/' +
    repoOwner +
    '/' +
    repoName +
    '/contents/' +
    filePath
  const headers = {
    Authorization: 'token ' + githubToken,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'Google-Apps-Script',
  }

  try {
    const getOptions = {
      method: 'get',
      headers: headers,
      muteHttpExceptions: true,
    }
    const res = urlFetchApp.fetch(url, getOptions)
    const statusCode = res.getResponseCode()

    let sha = null
    let rawContent = ''

    if (statusCode === 404) {
      console.log(
        '[gitHubSync] File not found on GitHub (HTTP 404). Initializing new note:',
        filePath
      )
      const topicTitle = extractTopicTitleFromPath(filePath)
      const dateStr = utils?.formatDate
        ? utils.formatDate(new Date(), 'GMT', 'yyyy-MM-dd')
        : new Date().toISOString().slice(0, 10)
      rawContent =
        '---\ntitle: ' +
        topicTitle +
        '\ncreated: ' +
        dateStr +
        '\nnotebook: household\nsection: general\n---\n\n' +
        '# ' +
        topicTitle +
        '\n\n' +
        '## 1. Executive Summary & Active Status\n- Ingested records log.\n\n' +
        '## 2. Key References & Quick Links\n| Topic | Asset |\n| :--- | :--- |\n\n' +
        '## 3. Ingested Activity Logs\n<details open><summary><b>Activity Logs</b></summary>\n</details>\n'
    } else if (statusCode === 200) {
      const fileData = JSON.parse(res.getContentText())
      sha = fileData.sha
      // GitHub Contents API wraps Base64 in newlines every 60 chars; strip them
      // before decoding since some decoders reject embedded whitespace.
      rawContent = utils
        .newBlob(
          utils.base64Decode((fileData.content || '').replace(/[\r\n]/g, ''))
        )
        .getDataAsString()

      if (
        rawContent.indexOf(entryMd.trim()) !== -1 ||
        (commitMessage && rawContent.indexOf(commitMessage) !== -1)
      ) {
        console.log(
          '[gitHubSync] Idempotent Skip: Entry already exists in',
          filePath
        )
        return 'IDEMPOTENT_SKIP'
      }
    } else {
      console.error(
        '[gitHubSync] Error fetching file from GitHub (HTTP ' +
          statusCode +
          '):',
        res.getContentText()
      )
      return false
    }

    const updatedContent = insertEntryIntoLogSection(rawContent, entryMd)

    assertClean_(entryMd, 'new entry for ' + filePath)

    const base64Updated = utils.base64Encode(
      utils.newBlob(updatedContent).getBytes()
    )

    // Validate the ACTUAL Base64 round trip at the payload boundary: decode what
    // we are about to PUT and confirm no non-ASCII character was flattened to
    // '?'. Comparing updatedContent to entryMd/rawContent directly is inert
    // because updatedContent contains both source strings unchanged.
    const renderedContent = utils
      .newBlob(utils.base64Decode(base64Updated))
      .getDataAsString()
    assertNoAsciiReplacement_(updatedContent, renderedContent)

    const putPayload = {
      message:
        commitMessage ||
        'feat(ingestion): append ingested document entry via Google Apps Script',
      content: base64Updated,
      branch: 'main',
    }
    if (sha) {
      putPayload.sha = sha
    }

    const putOptions = {
      method: 'put',
      headers: headers,
      contentType: 'application/json',
      payload: JSON.stringify(putPayload),
      muteHttpExceptions: true,
    }

    const putRes = urlFetchApp.fetch(url, putOptions)
    const putStatus = putRes.getResponseCode()

    if (putStatus === 200 || putStatus === 201) {
      console.log(
        '[gitHubSync] Successfully committed markdown entry to GitHub:',
        filePath
      )
      return true
    } else if (putStatus === 409) {
      console.warn('[gitHubSync] SHA collision (HTTP 409) on file:', filePath)
      return false
    } else {
      console.error(
        '[gitHubSync] Error committing to GitHub (HTTP ' + putStatus + '):',
        putRes.getContentText()
      )
      return false
    }
  } catch (e) {
    console.error('[gitHubSync] Exception calling GitHub API:', e.message)
    return false
  }
}

function formatAuditDate_(d) {
  const y = d.getFullYear()
  const m = ('0' + (d.getMonth() + 1)).slice(-2)
  const da = ('0' + d.getDate()).slice(-2)
  return y + '/' + m + '/' + da
}

function getSearchDateRange_(dateStr, days) {
  const parts = dateStr.split('-')
  const year = Number.parseInt(parts[0], 10)
  const month = Number.parseInt(parts[1], 10) - 1
  const day = Number.parseInt(parts[2], 10)
  const dt = new Date(year, month, day)

  const beforeDt = new Date(dt.getTime() + (days + 1) * 86400000)
  const afterDt = new Date(dt.getTime() - days * 86400000)

  return {
    after: formatAuditDate_(afterDt),
    before: formatAuditDate_(beforeDt),
  }
}

/**
 * Audits a collection of processed Gmail threads for classification anomalies.
 *
 * @param {Array} threads - Array of GmailThread-like objects
 * @param {Object} config - Classifier config
 * @returns {Object} report - { scannedCount, flaggedCount, findings, summary }
 */
function auditClassifications(threads, config) {
  const canonicalDomains = config?.canonicalDomains || [
    '01_Household',
    '02_Finance_Legal',
    '03_Vehicles',
    '04_Family_Health',
    '05_Tech_Infrastructure',
    '06_Work_Career',
    '07_Community_NonProfit',
  ]

  const PROMO_KEYWORDS =
    /\b(sale|\d+% off|deal of the day|clearance|limited time offer|coupon|shop now)\b/i
  const NEWSLETTER_KEYWORDS =
    /\b(weekly digest|daily digest|newsletter|roundup|top stories)\b/i
  const ORDER_KEYWORDS =
    /\b(order confirmation|your order|receipt|payment received|invoice|shipped)\b/i

  const findings = []

  if (!Array.isArray(threads)) {
    return {
      scannedCount: 0,
      flaggedCount: 0,
      findings: [],
      summary: 'No threads to audit.',
    }
  }

  threads.forEach((thread) => {
    if (!thread) return
    const id =
      typeof thread.getId === 'function' ? thread.getId() : thread.id || ''
    const subject =
      typeof thread.getFirstMessageSubject === 'function'
        ? thread.getFirstMessageSubject()
        : thread.subject || ''

    let sender = ''
    if (typeof thread.getMessages === 'function') {
      const msgs = thread.getMessages()
      if (msgs && msgs.length > 0 && typeof msgs[0].getFrom === 'function') {
        sender = msgs[0].getFrom()
      }
    } else if (thread.sender) {
      sender = thread.sender
    }

    let rawLabels = []
    if (typeof thread.getLabels === 'function') {
      const labelObjs = thread.getLabels() || []
      rawLabels = labelObjs.map((l) =>
        typeof l.getName === 'function' ? l.getName() : String(l)
      )
    } else if (Array.isArray(thread.labels)) {
      rawLabels = thread.labels
    }

    const assignedCanonical = rawLabels.filter(
      (l) => canonicalDomains.includes(l) || /^0[1-7]_/.test(l)
    )
    const flags = []

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
    const fullText = (subject + ' ' + sender).toLowerCase()
    if (ORDER_KEYWORDS.test(fullText)) {
      const hasFinanceOrHousehold = assignedCanonical.some(
        (l) =>
          l.includes('02_Finance_Legal') ||
          l.includes('01_Household') ||
          l.includes('03_Vehicles')
      )
      if (assignedCanonical.length > 0 && !hasFinanceOrHousehold) {
        flags.push(
          'SUSPICIOUS_ROUTING: Purchase/receipt keywords detected but domain is ' +
            assignedCanonical.join(', ') +
            ' instead of 02_Finance_Legal.'
        )
      }
    }

    if (PROMO_KEYWORDS.test(subject) && assignedCanonical.length > 0) {
      const hasMarketingSublabel = rawLabels.some((l) =>
        /promo|marketing|deal|coupon/i.test(l)
      )
      if (!hasMarketingSublabel) {
        flags.push(
          'PROMOTIONAL_CONTENT: Promotional sale keywords in subject tagged under core domain ' +
            assignedCanonical.join(', ') +
            ' without marketing sub-label.'
        )
      }
    }

    if (NEWSLETTER_KEYWORDS.test(subject) && assignedCanonical.length > 0) {
      const hasNewsletterSublabel = rawLabels.some((l) =>
        /newsletter|digest|news/i.test(l)
      )
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

  let text = '===================================================\n'
  text += '   GMAIL AI CLASSIFICATION AUDIT REPORT\n'
  text += '===================================================\n'
  text += report.summary + '\n\n'

  report.findings.forEach((finding, idx) => {
    text +=
      idx + 1 + '. Subject: "' + (finding.subject || '(no subject)') + '"\n'
    text += '   Sender:  ' + (finding.sender || '(unknown)') + '\n'
    text +=
      '   Labels:  ' + (finding.canonicalLabels.join(', ') || '(none)') + '\n'
    text += '   Flags:\n'
    finding.flags.forEach((f) => {
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

// ---------------------------------------------------------------------------
// Attachment Persistence to Google Drive along Taxonomy Path
// ---------------------------------------------------------------------------

const CANONICAL_TAXONOMY_SUBFOLDERS = {
  '01_Household': [
    'Primary_House',
    'Shop_Build',
    'Rental_Property',
    'Archive_Property',
    'Bills',
    'Maintenance',
  ],
  '02_Finance_Legal': [
    'Taxes',
    'Insurance',
    'Banking',
    'Legal_Court',
    'Estate_Planning',
    'Bills',
    'Purchases',
  ],
  '03_Vehicles': ['Car_Hunt', 'Vehicle_Fleet', 'Maintenance'],
  '04_Family_Health': [
    'Family_General',
    'Students',
    'Adults',
    'Medical_Records',
    'Activities_Camps',
  ],
  '05_Tech_Infrastructure': ['NAS_Backups', 'Tasker', 'Hardware_Licenses'],
  '06_Work_Career': ['Career_Interviews', 'Expenses_Admin'],
  '07_Community_NonProfit': ['Community_BOD', 'Projects_Telemetry'],
}

const SUBLABEL_TO_FOLDER_MAP = {
  // 01_Household
  'household/primary-property': 'Primary_House',
  'household/primary_house': 'Primary_House',
  'household/primary': 'Primary_House',
  'household/home-maintenance': 'Maintenance',
  'household/maintenance': 'Maintenance',
  'household/utilities': 'Bills',
  'household/bills': 'Bills',
  'household/shop': 'Shop_Build',
  'household/shop-build': 'Shop_Build',
  'household/travel': 'Primary_House',

  // 02_Finance_Legal
  'finance/banking': 'Banking',
  'finance/bills': 'Bills',
  'finance/taxes': 'Taxes',
  'finance/insurance': 'Insurance',
  'finance/purchases': 'Purchases',
  'finance/legal': 'Legal_Court',
  'finance/legal_court': 'Legal_Court',
  'finance/charitable-donations': 'Taxes',
  'finance/estate-planning': 'Estate_Planning',
  'finance/estate_planning': 'Estate_Planning',

  // 03_Vehicles
  'vehicles/maintenance': 'Maintenance',
  'vehicles/parts-orders': 'Maintenance',
  'vehicles/insurance': 'Insurance',
  'vehicles/registration': 'Maintenance',
  'vehicles/rental-cars': 'Maintenance',
  'vehicles/car-hunt': 'Car_Hunt',
  'vehicles/car_hunt': 'Car_Hunt',

  // 04_Family_Health
  'family/medical': 'Medical_Records',
  'family/medical-records': 'Medical_Records',
  'family/medical-student': 'Medical_Records',
  'family/health-general': 'Medical_Records',
  'family/school-student': 'Students',
  'family/personal-correspondence': 'Family_General',

  // 05_Tech_Infrastructure
  'tech/alerts-monitoring': 'NAS_Backups',
  'tech/backups': 'NAS_Backups',
  'tech/hardware': 'Hardware_Licenses',
  'tech/hardware-licenses': 'Hardware_Licenses',
  'tech/cloud-gcp': 'NAS_Backups',

  // 06_Work_Career
  'work/career': 'Career_Interviews',
  'work/notes': 'Career_Interviews',
  'work/expenses': 'Expenses_Admin',
  'work/expenses-admin': 'Expenses_Admin',
  'work/architecture': 'Career_Interviews',

  // 07_Community_NonProfit
  'projects/charity': 'Community_BOD',
  'community/bod': 'Community_BOD',
  'projects/telemetry': 'Projects_Telemetry',
  'community/nonprofit-bod': 'Community_BOD',
  'community/charity': 'Community_BOD',
}

const TRACKING_IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'ico',
])

const TRACKING_STEM_NAMES = new Set([
  'signature',
  'logo',
  'icon',
  'spacer',
  'pixel',
  'tracking',
  'banner',
  'facebook',
  'twitter',
  'instagram',
  'linkedin',
  'youtube',
])

function isTrackingOrSigImageName(fileName) {
  if (!fileName || typeof fileName !== 'string') return false
  const dotIndex = fileName.lastIndexOf('.')
  if (dotIndex <= 0) return false
  const ext = fileName.slice(dotIndex + 1).toLowerCase()
  if (!TRACKING_IMAGE_EXTENSIONS.has(ext)) return false
  const stem = fileName.slice(0, dotIndex).toLowerCase()
  if (TRACKING_STEM_NAMES.has(stem)) return true
  return /^image\d{3}$/.test(stem)
}

/**
 * Validates whether an email classification represents a canonical domain.
 * Non-canonical emails (promotions, newsletters, spam) return null/empty for canonicalDomain.
 *
 * @param {Object} classification - Gemini classification object
 * @param {Object} [config] - Classifier configuration
 * @returns {boolean} True if canonical domain, false if non-canonical or null
 */
function isCanonicalClassification(classification, config) {
  if (!classification || typeof classification !== 'object') return false
  const domain =
    classification.canonicalDomain || classification.canonical_label
  if (!domain || typeof domain !== 'string') return false
  const trimmed = domain.trim()
  if (trimmed === '' || trimmed === 'null' || trimmed === 'undefined')
    return false

  const allowedDomains = config?.canonicalDomains || [
    '01_Household',
    '02_Finance_Legal',
    '03_Vehicles',
    '04_Family_Health',
    '05_Tech_Infrastructure',
    '06_Work_Career',
    '07_Community_NonProfit',
  ]

  return allowedDomains.some(
    (d) => trimmed === d || trimmed.startsWith(d + '/')
  )
}

/**
 * Resolves the 2nd-level Google Drive taxonomy subfolder name given a canonical domain and sub-label.
 *
 * @param {string} canonicalDomain - e.g. "02_Finance_Legal"
 * @param {string} [subLabel] - e.g. "Finance/Banking" or "Bills"
 * @returns {string} Subfolder name
 */
function resolveTaxonomySubfolderName(canonicalDomain, subLabel) {
  if (subLabel && typeof subLabel === 'string') {
    const normalized = subLabel.trim().toLowerCase()
    if (SUBLABEL_TO_FOLDER_MAP[normalized]) {
      return SUBLABEL_TO_FOLDER_MAP[normalized]
    }

    const parts = subLabel.split('/')
    const subPart = (parts.length > 1 ? parts[1] : parts[0]).trim()
    const sanitized = subPart.replace(/[-\s]+/g, '_')

    const knownSubfolders = CANONICAL_TAXONOMY_SUBFOLDERS[canonicalDomain] || []
    const match = knownSubfolders.find(
      (sf) => sf.toLowerCase() === sanitized.toLowerCase()
    )
    if (match) return match

    if (sanitized.length > 0) return sanitized
  }

  const defaults = {
    '01_Household': 'Primary_House',
    '02_Finance_Legal': 'Banking',
    '03_Vehicles': 'Maintenance',
    '04_Family_Health': 'Medical_Records',
    '05_Tech_Infrastructure': 'NAS_Backups',
    '06_Work_Career': 'Career_Interviews',
    '07_Community_NonProfit': 'Community_BOD',
  }
  return defaults[canonicalDomain] || 'General'
}

/**
 * Evaluates whether an email attachment is an eligible document/payload
 * and filters out inline images, email signatures, and tracking pixels (< 15KB).
 *
 * @param {Object} att - Attachment blob or mock object
 * @returns {boolean} True if eligible, false if signature/pixel/empty
 */
function isEligibleAttachment(att) {
  if (!att) return false
  const name =
    typeof att.getName === 'function' ? att.getName() : att.name || ''
  if (!name || typeof name !== 'string' || name.trim().length === 0)
    return false

  let size = 0
  if (typeof att.getSize === 'function') {
    size = att.getSize()
  } else if (typeof att.getBytes === 'function') {
    const bytes = att.getBytes()
    size = bytes ? bytes.length : 0
  } else if (att.bytes) {
    size = att.bytes.length
  } else if (att.size !== undefined) {
    size = att.size
  }

  // 1. Skip empty files
  if (size <= 0) return false

  const cleanName = name.trim()
  const mimeType = (
    typeof att.getContentType === 'function'
      ? att.getContentType()
      : att.contentType || ''
  ).toLowerCase()

  // 2. Filter out known tracking / signature image names (< 25KB)
  if (isTrackingOrSigImageName(cleanName) && size < 25 * 1024) {
    return false
  }

  // 3. Filter out small image files (< 15KB) as signature icons / tracking pixels
  const isImage =
    mimeType.startsWith('image/') ||
    /\.(png|jpe?g|gif|webp|bmp|ico)$/i.test(cleanName)
  if (isImage && size < 15 * 1024) {
    return false
  }

  return true
}

function getOrCreateChildFolder_(parentFolder, folderName) {
  const folders = parentFolder.getFoldersByName(folderName)
  if (folders && typeof folders.hasNext === 'function' && folders.hasNext()) {
    return folders.next()
  }
  return parentFolder.createFolder(folderName)
}

/**
 * Idempotently traverses or creates the 2-level Drive taxonomy path (Domain / Subfolder).
 *
 * @param {string} canonicalDomain - e.g. "02_Finance_Legal"
 * @param {string} subfolderName - e.g. "Banking"
 * @param {Object} driveApp - GAS DriveApp service (injected)
 * @returns {Object} Target folder object
 */
function ensureDriveTaxonomyFolder(canonicalDomain, subfolderName, driveApp) {
  let drive = driveApp
  if (typeof drive === 'undefined') {
    drive = typeof DriveApp !== 'undefined' ? DriveApp : null
  }
  if (!drive) {
    throw new Error('DriveApp service unavailable')
  }

  const root =
    typeof drive.getRootFolder === 'function' ? drive.getRootFolder() : drive

  if (!root || typeof root.getFoldersByName !== 'function') {
    throw new Error('DriveApp service unavailable or invalid root folder')
  }

  const domainFolder = getOrCreateChildFolder_(root, canonicalDomain)
  if (!subfolderName) return domainFolder

  return getOrCreateChildFolder_(domainFolder, subfolderName)
}

function extractBlobBytes_(blob) {
  try {
    if (typeof blob?.getBytes === 'function') {
      return blob.getBytes() || Buffer.from('')
    }
    if (blob?.bytes) {
      return blob.bytes
    }
    if (Buffer.isBuffer(blob)) {
      return blob
    }
  } catch {
    return Buffer.from('')
  }
  return Buffer.from('')
}

function extractFileSize_(file) {
  if (!file) return 0
  if (typeof file.getSize === 'function') {
    return file.getSize()
  }
  if (file.size !== undefined) {
    return file.size
  }
  return 0
}

/**
 * Checks if an exact duplicate file already exists in target folder (size match + MD5 hash).
 *
 * @param {Object} existingFiles - Iterator from folder.getFilesByName
 * @param {Object} newFileBlob - Blob of incoming file
 * @param {Object} [helperFns] - Optional helper functions ({ getFileHash })
 * @returns {boolean}
 */
function isDuplicateAttachment(existingFiles, newFileBlob, helperFns) {
  if (
    !existingFiles ||
    typeof existingFiles.hasNext !== 'function' ||
    !newFileBlob
  ) {
    return false
  }
  const hashFn = helperFns?.getFileHash || getFileHash
  const newFileBytes = extractBlobBytes_(newFileBlob)
  const newFileLength = newFileBytes.length
  let newFileHash = ''
  try {
    newFileHash = hashFn(newFileBlob)
  } catch {
    return false
  }

  while (existingFiles.hasNext()) {
    const existingFile = existingFiles.next()
    if (extractFileSize_(existingFile) !== newFileLength) {
      continue
    }

    const existingBlob =
      typeof existingFile.getBlob === 'function'
        ? existingFile.getBlob()
        : existingFile
    if (hashFn(existingBlob) === newFileHash) {
      return true
    }
  }
  return false
}

/**
 * Resolves naming conflicts for attachments. If a file of the same name exists
 * with different content, appends a timestamp before the extension.
 *
 * @param {Object} folder - Target Drive folder
 * @param {string} fileName - Attachment filename
 * @param {Object} newFileBlob - Blob being saved
 * @param {Object} [options] - Injected GAS services ({ Utilities, Session })
 * @returns {string} Safe filename
 */
function resolveAttachmentName(folder, fileName, newFileBlob, options) {
  if (
    folder &&
    typeof folder.getFilesByName === 'function' &&
    !folder.getFilesByName(fileName).hasNext()
  ) {
    return fileName
  }

  const utils =
    options?.Utilities || (typeof Utilities !== 'undefined' ? Utilities : null)
  const session =
    options?.Session || (typeof Session !== 'undefined' ? Session : null)

  let timeTag =
    utils &&
    session &&
    typeof utils.formatDate === 'function' &&
    typeof session.getScriptTimeZone === 'function'
      ? utils.formatDate(new Date(), session.getScriptTimeZone(), '_HHmmssSSS')
      : '_' + Date.now()

  if (typeof timeTag === 'string' && !timeTag.startsWith('_')) {
    timeTag = '_' + timeTag.replace(/[^a-zA-Z0-9]/g, '')
  }

  const renamed = fileName.replace(/(\.[\w-]+)$/i, timeTag + '$1')
  const finalName = renamed === fileName ? fileName + timeTag : renamed

  if (newFileBlob && typeof newFileBlob.setName === 'function') {
    newFileBlob.setName(finalName)
  }
  return finalName
}

/**
 * Persists attached documents from a canonical email thread to Google Drive along
 * the label's taxonomy path, skipping duplicates and strictly ignoring non-canonical emails.
 *
 * @param {Object} thread - Gmail thread object
 * @param {Object} classification - AI classification result
 * @param {Object} config - Classifier config
 * @param {Object} services - Injected GAS services ({ DriveApp, Utilities, Session })
 * @returns {Object[]} Array of saved file metadata ({ name, url, id, domain, subfolder })
 */
function persistCanonicalAttachmentsToDrive(
  thread,
  classification,
  config,
  services
) {
  // STRICT NON-CANONICAL GATE: If email has no canonical domain, ignore attachments completely!
  if (!isCanonicalClassification(classification, config)) {
    console.log(
      '[persistCanonicalAttachmentsToDrive] Non-canonical or null domain; skipping attachment persistence.'
    )
    return []
  }

  let driveApp = services?.DriveApp
  if (typeof driveApp === 'undefined') {
    driveApp = typeof DriveApp !== 'undefined' ? DriveApp : null
  }
  if (!driveApp) {
    console.error(
      '[persistCanonicalAttachmentsToDrive] DriveApp is unavailable; cannot persist attachments.'
    )
    return []
  }

  const canonicalDomain =
    classification.canonicalDomain || classification.canonical_label
  const subLabel = classification.subLabel || ''
  const subfolderName = resolveTaxonomySubfolderName(canonicalDomain, subLabel)

  let targetFolder
  try {
    targetFolder = ensureDriveTaxonomyFolder(
      canonicalDomain,
      subfolderName,
      driveApp
    )
  } catch (err) {
    console.error(
      '[persistCanonicalAttachmentsToDrive] Failed to ensure taxonomy folder ' +
        canonicalDomain +
        '/' +
        subfolderName +
        ': ' +
        err.message
    )
    return []
  }

  const messages =
    typeof thread.getMessages === 'function' ? thread.getMessages() : []
  const savedFiles = []
  const helperFns = {
    getFileHash: services?.getFileHash || getFileHash,
  }

  messages.forEach((msg) => {
    const attachments =
      typeof msg.getAttachments === 'function' ? msg.getAttachments() : []
    attachments.forEach((att) => {
      if (!isEligibleAttachment(att)) {
        console.log(
          '[persistCanonicalAttachmentsToDrive] Skipped ineligible attachment (signature/tracking pixel or empty): ' +
            (typeof att.getName === 'function' ? att.getName() : 'unnamed')
        )
        return
      }

      const fileName =
        typeof att.getName === 'function' ? att.getName() : att.name
      const newFileBlob =
        typeof att.copyBlob === 'function' ? att.copyBlob() : att
      const existingFiles =
        typeof targetFolder.getFilesByName === 'function'
          ? targetFolder.getFilesByName(fileName)
          : null

      if (isDuplicateAttachment(existingFiles, newFileBlob, helperFns)) {
        console.log(
          '[persistCanonicalAttachmentsToDrive] Skipped exact duplicate attachment: ' +
            fileName
        )
        return
      }

      const finalName = resolveAttachmentName(
        targetFolder,
        fileName,
        newFileBlob,
        services
      )
      console.log(
        '[persistCanonicalAttachmentsToDrive] Saving attachment to ' +
          canonicalDomain +
          '/' +
          subfolderName +
          ': ' +
          finalName
      )

      try {
        const file = targetFolder.createFile(newFileBlob)
        const fileId = typeof file.getId === 'function' ? file.getId() : ''
        const fileUrl =
          typeof file.getUrl === 'function'
            ? file.getUrl()
            : 'https://drive.google.com/file/d/' + fileId
        savedFiles.push({
          name: typeof file.getName === 'function' ? file.getName() : finalName,
          url: fileUrl,
          id: fileId,
          domain: canonicalDomain,
          subfolder: subfolderName,
        })
      } catch (saveErr) {
        console.error(
          '[persistCanonicalAttachmentsToDrive] Error saving file ' +
            finalName +
            ': ' +
            saveErr.message
        )
      }
    })
  })

  return savedFiles
}

module.exports = {
  validateClassification,
  classifyEmailWithGemini,
  ensureGmailLabel,
  createPermanentGmailFilter,
  processThreadBatch,
  RULE6_PATTERNS,
  assertClean_,
  assertNoAsciiReplacement_,
  extractTopicTitleFromPath,
  insertEntryIntoLogSection,
  formatProgressiveDisclosureEntry,
  getNotePathForDomain,
  appendMarkdownEntryToGitHubRepo,
  executeGitHubCommit,
  getSearchDateRange_,
  auditClassifications,
  formatAuditDigest,
  isCanonicalClassification,
  resolveTaxonomySubfolderName,
  isEligibleAttachment,
  ensureDriveTaxonomyFolder,
  isDuplicateAttachment,
  resolveAttachmentName,
  persistCanonicalAttachmentsToDrive,
  CANONICAL_TAXONOMY_SUBFOLDERS,
  SUBLABEL_TO_FOLDER_MAP,
}
