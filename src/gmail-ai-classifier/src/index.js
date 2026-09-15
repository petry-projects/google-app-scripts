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
  return null
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
  return topic.replace(/-/g, ' ').replace(/\b\w/g, function (l) {
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
  accountEmail
) {
  let entry = '\n### ' + dateStr + ' — ' + title + '\n'
  entry += '- **Account**: ' + accountEmail + '\n'
  entry += '- **From**: ' + sender + '\n'
  entry += '- **Subject**: ' + subject + '\n'
  if (summaryText) {
    entry += '- **Summary**:\n  > ' + summaryText.trim() + '\n'
  }
  return entry
}

function getNotePathForDomain(domain, subLabel) {
  if (
    subLabel === 'Projects/HoneyBeeHam' ||
    subLabel === 'Household/HoneyBeeHam'
  ) {
    return 'petry-household/birmingham/index.md'
  }
  const map = {
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

  const url =
    'https://api.github.com/repos/' +
    GITHUB_REPO_OWNER +
    '/' +
    GITHUB_REPO_NAME +
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
        '\nnotebook: petry-household\nsection: general\n---\n\n' +
        '# ' +
        topicTitle +
        '\n\n' +
        '## 1. Executive Summary & Active Status\n- Ingested records log.\n\n' +
        '## 2. Key References & Quick Links\n| Topic | Asset |\n| :--- | :--- |\n\n' +
        '## 3. Ingested Activity Logs\n<details open><summary><b>Activity Logs</b></summary>\n</details>\n'
    } else if (statusCode === 200) {
      const fileData = JSON.parse(res.getContentText())
      sha = fileData.sha
      rawContent = utils
        .newBlob(utils.base64Decode(fileData.content))
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
    if (rawContent) {
      assertNoAsciiReplacement_(rawContent, updatedContent)
    }
    assertNoAsciiReplacement_(entryMd, updatedContent)

    const base64Updated = utils.base64Encode(
      utils.newBlob(updatedContent).getBytes()
    )

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

function getSearchDateRange_(dateStr, days) {
  const parts = dateStr.split('-')
  const year = parseInt(parts[0], 10)
  const month = parseInt(parts[1], 10) - 1
  const day = parseInt(parts[2], 10)
  const dt = new Date(year, month, day)

  const beforeDt = new Date(dt.getTime() + (days + 1) * 86400000)
  const afterDt = new Date(dt.getTime() - days * 86400000)

  function fmt(d) {
    const y = d.getFullYear()
    const m = ('0' + (d.getMonth() + 1)).slice(-2)
    const da = ('0' + d.getDate()).slice(-2)
    return y + '/' + m + '/' + da
  }
  return { after: fmt(afterDt), before: fmt(beforeDt) }
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
}
