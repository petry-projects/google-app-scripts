/**
 * Gmail to Drive processing utilities.
 *
 * Designed to be testable outside of Google Apps Script by accepting
 * objects that match the minimal interfaces used.
 */

const { getCleanBody, getFileHash } = require('../../gas-utils')

/**
 * Remove existing thread content from the document by finding the separator
 * containing the given thread ID and deleting all paragraphs from the previous
 * thread separator (or start of the document) through that separator (inclusive).
 *
 * @param {Object} body - Document body object
 * @param {string} threadId - The thread ID to search for
 * @returns {boolean} True if thread was found and removed, false otherwise
 */
function removeExistingThread(body, threadId) {
  if (!threadId) return false

  const paragraphs = body.getParagraphs()
  const threadMarker = `[THREAD:${threadId}]`

  // Find the separator containing this thread ID
  let threadSeparatorIndex = -1
  for (let i = 0; i < paragraphs.length; i++) {
    const text = paragraphs[i].getText()
    if (text.includes(threadMarker)) {
      threadSeparatorIndex = i
      break
    }
  }

  if (threadSeparatorIndex === -1) {
    console.log('[removeExistingThread] Thread not found:', threadId)
    return false // Thread not found in document
  }

  console.log(
    '[removeExistingThread] Found thread separator at paragraph',
    threadSeparatorIndex
  )

  // Find the start of this thread's content (search backwards from thread separator to previous thread separator or start)
  let threadStartIndex = 0
  for (let i = threadSeparatorIndex - 1; i >= 0; i--) {
    const text = paragraphs[i].getText()
    // Stop when we hit another thread separator (indicated by [THREAD:])
    if (text.includes('[THREAD:')) {
      threadStartIndex = i + 1 // Start after the previous thread separator
      break
    }
  }

  console.log(
    '[removeExistingThread] Removing paragraphs from',
    threadStartIndex,
    'to',
    threadSeparatorIndex
  )

  // Remove all paragraphs from threadStartIndex to threadSeparatorIndex (inclusive)
  // Remove in reverse order to avoid index shifting issues
  for (let i = threadSeparatorIndex; i >= threadStartIndex; i--) {
    const para = paragraphs[i]
    para.removeFromParent()
  }

  console.log('[removeExistingThread] Successfully removed thread:', threadId)
  return true
}

/**
 * Read a blob's raw bytes, tolerating both GAS blobs (getBytes) and test mocks
 * (bytes property), falling back to an empty buffer.
 *
 * @param {Object} blob - Blob-like object
 * @returns {Array|Buffer} Byte array
 */
function getBlobBytes(blob) {
  if (blob.getBytes) return blob.getBytes()
  return blob.bytes || Buffer.from('')
}

/**
 * Insert the subject heading paragraph, applying HEADING_3 style (or a bold
 * fallback) when a DocumentApp service is available.
 *
 * @param {Object} body - Document body object
 * @param {number} index - Insertion index
 * @param {string} subject - Message subject
 * @param {Object} [DocumentApp] - GAS DocumentApp service (optional)
 */
function insertHeading(body, index, subject, DocumentApp) {
  const subjectText = 'Subject: ' + (subject ? subject : '(No Subject)')
  const headingPara = body.insertParagraph(index, subjectText)
  if (!DocumentApp) return
  try {
    headingPara.setHeading(DocumentApp.ParagraphHeading.HEADING_3)
  } catch {
    const style = {}
    style[DocumentApp.Attribute.BOLD] = true
    headingPara.setAttributes(style)
  }
}

/**
 * Insert a thread separator (embedding the thread ID) when requested, otherwise
 * a plain separator.
 *
 * @param {Object} body - Document body object
 * @param {number} index - Insertion index
 * @param {string} threadId - Thread ID
 * @param {boolean} useThreadSeparator - Whether to embed the thread ID
 */
function insertSeparator(body, index, threadId, useThreadSeparator) {
  if (threadId && useThreadSeparator) {
    body.insertParagraph(
      index,
      `------------------------------[THREAD:${threadId}]`
    )
  } else {
    body.insertParagraph(index, '------------------------------')
  }
}

/**
 * Determine whether an attachment blob already exists in the folder by comparing
 * size then MD5 hash against every existing file sharing its name.
 *
 * @param {Object} folder - Drive folder object
 * @param {string} fileName - Attachment name
 * @param {Object} newFileBlob - Blob for the incoming attachment
 * @param {Function} hashFn - Function that hashes a blob
 * @returns {boolean} True if an identical file already exists
 */
function isDuplicateAttachment(folder, fileName, newFileBlob, hashFn) {
  const existingFiles = folder.getFilesByName(fileName)
  const newFileBytes = getBlobBytes(newFileBlob)
  while (existingFiles.hasNext()) {
    const existingFile = existingFiles.next()
    if (existingFile.getSize() !== newFileBytes.length) continue
    if (hashFn(existingFile.getBlob()) === hashFn(newFileBlob)) return true
  }
  return false
}

/**
 * When a same-named (but different-content) file already exists, derive a
 * timestamp-suffixed name and apply it to the blob.
 *
 * @param {Object} folder - Drive folder object
 * @param {string} fileName - Original attachment name
 * @param {Object} newFileBlob - Blob to rename in place
 * @param {Object} options - May carry Utilities and Session GAS services
 * @returns {string} The resolved (possibly renamed) file name
 */
function resolveDuplicateName(folder, fileName, newFileBlob, options) {
  if (!folder.getFilesByName(fileName).hasNext()) return fileName
  const { Utilities, Session } = options
  const timeTag =
    Utilities && Session
      ? Utilities.formatDate(new Date(), Session.getScriptTimeZone(), '_HHmmss')
      : '_' + Date.now()
  let newName = fileName.replace(/(\.[\w\d_-]+)$/i, timeTag + '$1')
  if (newName === fileName) newName += timeTag
  if (newFileBlob.setName) newFileBlob.setName(newName)
  return newName
}

/**
 * Process a single attachment: skip exact duplicates, otherwise save it
 * (renaming on name conflicts) and record the result in the doc body.
 *
 * @param {Object} att - Gmail attachment object
 * @param {Object} body - Document body object
 * @param {number} startIndex - Index at which to insert paragraphs
 * @param {Object} folder - Drive folder object
 * @param {Object} options - Optional GAS services (Logger, Utilities, Session)
 * @param {Function} hashFn - Function that hashes a blob
 * @returns {number} Number of paragraphs inserted
 */
function processAttachment(att, body, startIndex, folder, options, hashFn) {
  const { Logger } = options
  const fileName = att.getName()
  // In GAS environment, copyBlob() creates a copy; in tests, att itself is the blob.
  const newFileBlob = att.copyBlob ? att.copyBlob() : att

  if (isDuplicateAttachment(folder, fileName, newFileBlob, hashFn)) {
    if (Logger) Logger.log('Skipping exact duplicate: ' + fileName)
    body.insertParagraph(startIndex, '- [DUPLICATE SKIPPED] ' + fileName)
    return 1
  }

  resolveDuplicateName(folder, fileName, newFileBlob, options)
  const file = folder.createFile(newFileBlob)
  body.insertParagraph(startIndex, '- ' + file.getName())
  return 1
}

/**
 * Prepend a single message's content (subject, date, body, attachments,
 * separator) into the document body starting at index 0.
 *
 * @param {Object} message - Gmail message object
 * @param {Object} body - Document body object
 * @param {Object} folder - Drive folder object
 * @param {Object} options - Optional settings and GAS services. Recognised keys:
 *   DocumentApp, Utilities, Logger, Session, threadId, useThreadSeparator,
 *   getCleanBody (injected content cleaner).
 * @param {Function} hashFn - Function that hashes a blob (for dedup)
 * @returns {number} Number of paragraphs inserted
 */
function insertMessageContent(message, body, folder, options, hashFn) {
  const { DocumentApp, Utilities, Logger, threadId, useThreadSeparator } =
    options
  const cleanBody = options.getCleanBody || getCleanBody

  const subject = message.getSubject()
  const cleanContent = cleanBody(message.getPlainBody())
  const timestamp = message.getDate()

  if (Logger) Logger.log('Processing: ' + subject)

  let currentIndex = 0
  insertHeading(body, currentIndex++, subject, DocumentApp)
  body.insertParagraph(currentIndex++, 'Date: ' + timestamp)
  body.insertParagraph(currentIndex++, cleanContent)

  const attachments = message.getAttachments()
  if (attachments.length > 0) {
    body.insertParagraph(currentIndex++, '[Attachments]:')
    attachments.forEach((att) => {
      currentIndex += processAttachment(
        att,
        body,
        currentIndex,
        folder,
        options,
        hashFn
      )
    })
  }

  insertSeparator(body, currentIndex++, threadId, useThreadSeparator)

  if (Utilities) Utilities.sleep(500)

  return currentIndex
}

/**
 * Process a single message and prepend its content to the document body.
 *
 * @param {Object} message - Gmail message object
 * @param {Object} body - Document body object
 * @param {Object} folder - Drive folder object
 * @param {Object} options - Optional settings (DocumentApp, Utilities, Logger, Session, threadId, isBottomMessage)
 * @returns {number} Number of paragraphs inserted
 */
function processMessageToDoc(message, body, folder, options = {}) {
  return insertMessageContent(
    message,
    body,
    folder,
    { ...options, useThreadSeparator: options.isBottomMessage },
    getFileHash
  )
}

/**
 * Process multiple messages from a thread, prepending them to the document.
 * Messages are sorted by date (oldest first) so newest appear at top.
 * If a threadId is provided, any existing content for that thread will be removed first,
 * and the last message separator will be replaced with a thread separator containing the ID.
 *
 * @param {Array} messages - Array of Gmail message objects
 * @param {Object} body - Document body object
 * @param {Object} folder - Drive folder object
 * @param {Object} options - Optional settings (threadId, DocumentApp, Utilities, Logger, Session for GAS)
 * @returns {number} Total number of messages processed
 */
function processMessagesToDoc(messages, body, folder, options = {}) {
  const { threadId } = options

  // If threadId is provided, remove any existing content for this thread
  if (threadId) {
    removeExistingThread(body, threadId)
  }

  // Sort messages by date (oldest first) so when we prepend (insert at index 0),
  // the newest messages end up at the top of the document
  const sortedMessages = messages.slice().sort(function (a, b) {
    return a.getDate().getTime() - b.getDate().getTime()
  })

  sortedMessages.forEach((message, msgIndex) => {
    console.log(
      '[processMessagesToDoc] Processing message',
      msgIndex + 1,
      'of',
      sortedMessages.length
    )
    // The first message in sorted array (oldest) will be inserted last and end up at bottom
    // So it should get the thread separator
    const isBottomMessage = msgIndex === 0
    processMessageToDoc(message, body, folder, { ...options, isBottomMessage })
  })

  // Add a clear separator between threads (after all messages in a thread are processed)
  if (sortedMessages.length > 0) {
    body.insertParagraph(0, '==============================')
  }

  return sortedMessages.length
}

/**
 * Sort threads by their last message date in reverse chronological order (newest first).
 * This ensures threads are always processed in the correct order regardless of how
 * the Gmail API returns them or when they were labeled.
 *
 * @param {Array} threads - Array of Gmail thread objects
 * @returns {Array} Sorted array of threads (newest first)
 */
/**
 * Sort threads by last message date (oldest first) for prepend-based processing.
 * Since messages are prepended at index 0, sorting oldest-first ensures the newest
 * thread is processed last and ends up at the top of the document.
 *
 * @param {Array} threads - Array of Gmail thread objects
 * @returns {Array} Sorted array of threads (oldest first)
 */
function sortThreadsByLastMessageDate(threads) {
  return threads.slice().sort(function (a, b) {
    const aMessages = a.getMessages()
    const bMessages = b.getMessages()
    const aLastDate = aMessages[aMessages.length - 1].getDate().getTime()
    const bLastDate = bMessages[bMessages.length - 1].getDate().getTime()
    return aLastDate - bLastDate // Ascending order (oldest first)
  })
}

/**
 * Main function to process all configurations.
 * Reads settings and processes each label group.
 *
 * @param {Array} configs - Array of configuration objects
 * @param {Function} processLabelGroupFn - Function to process each label group
 */
function storeEmailsAndAttachments(configs, processLabelGroupFn) {
  console.log('[storeEmailsAndAttachments] Starting email processing')
  console.log(
    '[storeEmailsAndAttachments] Processing',
    configs.length,
    'configurations'
  )

  configs.forEach((config, index) => {
    console.log(
      '[storeEmailsAndAttachments] Processing config',
      index + 1,
      'of',
      configs.length,
      ':',
      config.triggerLabel
    )
    processLabelGroupFn(config)
  })
  console.log('[storeEmailsAndAttachments] Completed all processing')
}

/**
 * Processes a single configuration group (Label -> Doc + Folder).
 * Extracts threads from trigger label, processes them, and moves to processed label.
 *
 * @param {Object} config - Configuration object with triggerLabel, processedLabel, docId, folderId
 * @param {Object} services - GAS services object with GmailApp, DocumentApp, DriveApp, Logger, Utilities, Session
 * @param {Object} helperFns - Helper functions object with getCleanBody, getFileHash, removeExistingThreadFromDoc
 */
/**
 * Look up the trigger label and processed label, creating the processed label
 * if it does not exist.
 *
 * @param {Object} GmailApp - GAS GmailApp service
 * @param {Object} config - Configuration with triggerLabel and processedLabel
 * @param {Object} Logger - GAS Logger service
 * @returns {{triggerLabel: Object, processedLabel: Object}} Resolved labels
 */
function resolveLabels(GmailApp, config, Logger) {
  const triggerLabel = GmailApp.getUserLabelByName(config.triggerLabel)
  let processedLabel = GmailApp.getUserLabelByName(config.processedLabel)

  if (!processedLabel) {
    try {
      processedLabel = GmailApp.createLabel(config.processedLabel)
    } catch {
      Logger.log('Could not create label: ' + config.processedLabel)
    }
  }

  if (!triggerLabel) {
    Logger.log('Trigger label not found: ' + config.triggerLabel)
  }

  return { triggerLabel, processedLabel }
}

/**
 * Open the destination document body and Drive folder for a config.
 *
 * @param {Object} DocumentApp - GAS DocumentApp service
 * @param {Object} DriveApp - GAS DriveApp service
 * @param {Object} config - Configuration with docId and folderId
 * @param {Object} Logger - GAS Logger service
 * @returns {{body: Object, folder: Object}|null} Doc body and folder, or null on error
 */
function openDocAndFolder(DocumentApp, DriveApp, config, Logger) {
  try {
    const doc = DocumentApp.openById(config.docId)
    return {
      body: doc.getBody(),
      folder: DriveApp.getFolderById(config.folderId),
    }
  } catch (e) {
    Logger.log(
      'Error opening Doc or Folder. Check IDs in Config.gs. Error: ' + e.message
    )
    return null
  }
}

/**
 * Process every message in a thread (oldest first) and update the thread's
 * labels once complete.
 *
 * @param {Object} thread - Gmail thread object
 * @param {Object} body - Document body object
 * @param {Object} folder - Drive folder object
 * @param {Object} ctx - Context: triggerLabel, processedLabel,
 *   removeExistingThreadFromDoc, messageOptions, hashFn
 */
function processThread(thread, body, folder, ctx) {
  const {
    triggerLabel,
    processedLabel,
    removeExistingThreadFromDoc,
    messageOptions,
    hashFn,
  } = ctx
  const threadId = thread.getId()
  const messages = thread.getMessages()

  removeExistingThreadFromDoc(body, threadId)

  // Sort messages oldest-first so prepending leaves the newest at the top.
  messages.sort(function (a, b) {
    return a.getDate().getTime() - b.getDate().getTime()
  })

  messages.forEach((message, msgIndex) => {
    insertMessageContent(
      message,
      body,
      folder,
      { ...messageOptions, threadId, useThreadSeparator: msgIndex === 0 },
      hashFn
    )
  })

  triggerLabel.removeFromThread(thread)
  if (processedLabel) processedLabel.addToThread(thread)
}

function processLabelGroup(config, services, helperFns) {
  const { GmailApp, DocumentApp, DriveApp, Logger, Utilities, Session } =
    services
  const { getCleanBody, getFileHash, removeExistingThreadFromDoc } = helperFns

  const { triggerLabel, processedLabel } = resolveLabels(
    GmailApp,
    config,
    Logger
  )
  if (!triggerLabel) return

  const threads = triggerLabel.getThreads()
  if (!threads || threads.length === 0) {
    Logger.log('No emails found for: ' + config.triggerLabel)
    return
  }

  // Sort threads by last message date so the newest thread ends up at the top.
  const sortedThreads = sortThreadsByLastMessageDate(threads)

  const target = openDocAndFolder(DocumentApp, DriveApp, config, Logger)
  if (!target) return
  const { body, folder } = target

  const messageOptions = {
    DocumentApp,
    Utilities,
    Logger,
    Session,
    getCleanBody,
  }
  sortedThreads.forEach((thread) => {
    processThread(thread, body, folder, {
      triggerLabel,
      processedLabel,
      removeExistingThreadFromDoc,
      messageOptions,
      hashFn: getFileHash,
    })
  })
}

/**
 * Rebuild all configured documents.
 *
 * @param {Array} configs - Array of configuration objects
 * @param {Function} rebuildDocFn - Function to rebuild a single doc
 * @returns {boolean} True if all completed, false if paused
 */
function rebuildAllDocs(configs, rebuildDocFn) {
  console.log('[rebuildAllDocs] Starting rebuild process')
  console.log('[rebuildAllDocs] Rebuilding', configs.length, 'configurations')

  let completed = true
  for (let i = 0; i < configs.length; i++) {
    const config = configs[i]
    console.log(
      '[rebuildAllDocs] Rebuilding config',
      i + 1,
      'of',
      configs.length,
      ':',
      config.triggerLabel
    )
    const configCompleted = rebuildDocFn(config)
    if (!configCompleted) {
      console.log(
        '[rebuildAllDocs] Paused due to time constraints. Run rebuildAllDocs() again to continue.'
      )
      completed = false
      break
    }
  }

  if (completed) {
    console.log('[rebuildAllDocs] Rebuild preparation complete.')
    console.log(
      '[rebuildAllDocs] Now run storeEmailsAndAttachments() to reprocess all emails.'
    )
  }

  return completed
}

/**
 * Rebuilds a single document by clearing it and moving processed emails back to trigger label.
 * Uses batching and state tracking to handle large label sets without timing out.
 *
 * @param {Object} config - Configuration object
 * @param {Object} services - GAS services object with GmailApp, DocumentApp, PropertiesService
 * @returns {boolean} True if completed, false if needs to continue in another execution
 */
function rebuildDoc(config, services) {
  const { GmailApp, DocumentApp, PropertiesService } = services
  const MAX_EXECUTION_TIME = 4 * 60 * 1000 // 4 minutes (leaving 2 min buffer for 6 min limit)
  const BATCH_SIZE = config.batchSize || 250 // Process threads in batches (default: 250)
  const startTime = new Date().getTime()

  console.log('[rebuildDoc] Starting rebuild for:', config.triggerLabel)

  const triggerLabelName = config.triggerLabel
  const processedLabelName = config.processedLabel
  const stateKey =
    'rebuild_state_' + triggerLabelName.replace(/[^a-zA-Z0-9]/g, '_')

  // 1. Validate and get labels
  console.log('[rebuildDoc] Looking up labels')
  const triggerLabel = GmailApp.getUserLabelByName(triggerLabelName)
  const processedLabel = GmailApp.getUserLabelByName(processedLabelName)

  if (!triggerLabel) {
    console.error('[rebuildDoc] Trigger label not found:', triggerLabelName)
    return true // Nothing to do, consider complete
  }

  if (!processedLabel) {
    console.log(
      '[rebuildDoc] Processed label not found:',
      processedLabelName,
      '- nothing to unarchive'
    )
  }

  // 2. Check if we need to clear the document (only on first run)
  const properties = PropertiesService.getUserProperties()
  const rebuildState = properties.getProperty(stateKey)
  const state = rebuildState ? JSON.parse(rebuildState) : { phase: 'clear_doc' }

  if (state.phase === 'clear_doc') {
    console.log('[rebuildDoc] Clearing document:', config.docId)
    try {
      const doc = DocumentApp.openById(config.docId)
      const body = doc.getBody()

      // Clear all content from the document body in a single operation
      body.setText('')
      console.log('[rebuildDoc] Document cleared')

      // Move to next phase
      state.phase = 'move_emails'
      state.processedCount = 0
      properties.setProperty(stateKey, JSON.stringify(state))
      console.log('[rebuildDoc] Saved state, moving to email processing phase')
    } catch (e) {
      console.error('[rebuildDoc] Error clearing document:', e.message)
      // Try again next time
      return false
    }
  }

  // 3. Move emails from processed back to trigger label (batched)
  if (state.phase === 'move_emails' && processedLabel) {
    console.log('[rebuildDoc] Moving emails from processed to trigger label')
    console.log(
      '[rebuildDoc] Resuming from:',
      state.processedCount,
      'threads processed'
    )

    const threads = processedLabel.getThreads()
    console.log('[rebuildDoc] Found', threads.length, 'threads to move')

    // Process in batches, always from index 0 since we're removing items
    let batchCount = 0
    while (batchCount < BATCH_SIZE && threads.length > 0) {
      // Check if we're running out of time
      const elapsed = new Date().getTime() - startTime
      if (elapsed > MAX_EXECUTION_TIME) {
        console.log('[rebuildDoc] Approaching time limit, saving progress')
        state.processedCount += batchCount
        properties.setProperty(stateKey, JSON.stringify(state))
        return false // Not complete, run again
      }

      // Always process index 0 since removing items shrinks the array
      const thread = threads[0]
      processedLabel.removeFromThread(thread)
      triggerLabel.addToThread(thread)
      batchCount++

      // Refresh threads array
      threads.splice(0, 1)
    }

    console.log('[rebuildDoc] Moved', batchCount, 'threads in this batch')
    state.processedCount += batchCount

    // Check if we're done
    if (processedLabel.getThreads().length === 0) {
      console.log('[rebuildDoc] All threads moved')
      state.phase = 'complete'
      properties.setProperty(stateKey, JSON.stringify(state))
    } else {
      // Still more threads to process
      console.log(
        '[rebuildDoc] Still',
        processedLabel.getThreads().length,
        'threads remaining'
      )
      properties.setProperty(stateKey, JSON.stringify(state))
      return false // Not complete, need to run again
    }
  }

  // If we got here, we're done
  properties.deleteProperty(stateKey)
  console.log('[rebuildDoc] Rebuild complete for:', config.triggerLabel)
  console.log(
    '[rebuildDoc] Run storeEmailsAndAttachments() to reprocess these emails'
  )
  return true
}

module.exports = {
  processMessageToDoc,
  processMessagesToDoc,
  sortThreadsByLastMessageDate,
  removeExistingThread,
  storeEmailsAndAttachments,
  processLabelGroup,
  rebuildAllDocs,
  rebuildDoc,
}
