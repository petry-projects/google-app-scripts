/**
 * Gmail to Drive processing utilities.
 * 
 * Designed to be testable outside of Google Apps Script by accepting
 * objects that match the minimal interfaces used.
 */

const { getCleanBody, getFileHash } = require('../../gas-utils');

/**
 * Remove existing thread content from the document by finding and deleting
 * all paragraphs between the thread's separator and the next separator (or start).
 * 
 * @param {Object} body - Document body object
 * @param {string} threadId - The thread ID to search for
 * @returns {boolean} True if thread was found and removed, false otherwise
 */
function removeExistingThread(body, threadId) {
  if (!threadId) return false;
  
  const paragraphs = body.getParagraphs();
  const threadMarker = `[THREAD:${threadId}]`;
  
  // Find the separator containing this thread ID
  let threadSeparatorIndex = -1;
  for (let i = 0; i < paragraphs.length; i++) {
    const text = paragraphs[i].getText();
    if (text.includes(threadMarker)) {
      threadSeparatorIndex = i;
      break;
    }
  }
  
  if (threadSeparatorIndex === -1) {
    console.log('[removeExistingThread] Thread not found:', threadId);
    return false; // Thread not found in document
  }
  
  console.log('[removeExistingThread] Found thread separator at paragraph', threadSeparatorIndex);
  
  // Find the start of this thread's content (search backwards from thread separator to previous thread separator or start)
  let threadStartIndex = 0;
  for (let i = threadSeparatorIndex - 1; i >= 0; i--) {
    const text = paragraphs[i].getText();
    // Stop when we hit another thread separator (indicated by [THREAD:])
    if (text.includes('[THREAD:')) {
      threadStartIndex = i + 1; // Start after the previous thread separator
      break;
    }
  }
  
  console.log('[removeExistingThread] Removing paragraphs from', threadStartIndex, 'to', threadSeparatorIndex);
  
  // Remove all paragraphs from threadStartIndex to threadSeparatorIndex (inclusive)
  // Remove in reverse order to avoid index shifting issues
  for (let i = threadSeparatorIndex; i >= threadStartIndex; i--) {
    const para = paragraphs[i];
    para.removeFromParent();
  }
  
  console.log('[removeExistingThread] Successfully removed thread:', threadId);
  return true;
}

/**
 * Process a single message and prepend its content to the document body.
 * Returns the number of paragraphs inserted.
 * 
 * @param {Object} message - Gmail message object
 * @param {Object} body - Document body object
 * @param {Object} folder - Drive folder object
 * @param {Object} options - Optional settings (DocumentApp, Utilities, Logger, Session for GAS)
 * @returns {number} Number of paragraphs inserted
 */
function processMessageToDoc(message, body, folder, options = {}) {
  const { DocumentApp, Utilities, Logger, Session } = options;
  
  const subject = message.getSubject();
  const rawContent = message.getPlainBody();
  const cleanContent = getCleanBody(rawContent);
  const timestamp = message.getDate();
  
  if (Logger) {
    Logger.log("Processing: " + subject);
  }
  console.log('[processMessageToDoc] Processing message:', subject);
  
  let currentIndex = 0;
  
  // Insert subject
  const subjectText = "Subject: " + (subject ? subject : "(No Subject)");
  const headingPara = body.insertParagraph(currentIndex++, subjectText);
  
  // Try to set heading style (GAS only)
  if (DocumentApp) {
    try {
      headingPara.setHeading(DocumentApp.ParagraphHeading.HEADING_3);
    } catch (e) {
      const style = {};
      style[DocumentApp.Attribute.BOLD] = true;
      headingPara.setAttributes(style);
    }
  }
  
  // Insert date and content
  body.insertParagraph(currentIndex++, "Date: " + timestamp);
  body.insertParagraph(currentIndex++, cleanContent);
  
  // Process attachments
  const attachments = message.getAttachments();
  console.log('[processMessageToDoc] Found', attachments.length, 'attachments');
  
  if (attachments.length > 0) {
    body.insertParagraph(currentIndex++, "[Attachments]:");
    
    attachments.forEach((att, attIndex) => {
      console.log('[processMessageToDoc] Processing attachment', attIndex + 1, 'of', attachments.length, ':', att.getName());
      
      let fileName = att.getName();
      // In GAS environment, copyBlob() creates a copy; in test environment, att itself is the blob
      const newFileBlob = att.copyBlob ? att.copyBlob() : att;
      let isDuplicate = false;
      
      // Check for duplicates by content hash
      const existingFiles = folder.getFilesByName(fileName);
      console.log('[processMessageToDoc] Checking for existing files named:', fileName);
      
      let existingCount = 0;
      while (existingFiles.hasNext()) {
        existingCount++;
        const existingFile = existingFiles.next();
        console.log('[processMessageToDoc] Comparing with existing file', existingCount);
        
        // Compare sizes first (fast fail)
        // Try getBytes() for GAS blobs, bytes property for test mocks, empty buffer as fallback
        const newFileBytes = newFileBlob.getBytes ? newFileBlob.getBytes() : newFileBlob.bytes || Buffer.from('');
        if (existingFile.getSize() === newFileBytes.length) {
          console.log('[processMessageToDoc] Size match, checking hash');
          
          // Deep check: compare MD5 hashes
          const existingHash = getFileHash(existingFile.getBlob());
          const newHash = getFileHash(newFileBlob);
          
          if (existingHash === newHash) {
            console.log('[processMessageToDoc] Hash match - duplicate detected');
            isDuplicate = true;
            break;
          } else {
            console.log('[processMessageToDoc] Hash mismatch - different content');
          }
        } else {
          console.log('[processMessageToDoc] Size mismatch - different file');
        }
      }
      
      if (isDuplicate) {
        if (Logger) {
          Logger.log("Skipping exact duplicate: " + fileName);
        }
        console.log('[processMessageToDoc] Skipping duplicate:', fileName);
        body.insertParagraph(currentIndex++, "- [DUPLICATE SKIPPED] " + fileName);
      } else {
        // Handle name conflicts (same name, different content)
        if (folder.getFilesByName(fileName).hasNext()) {
          console.log('[processMessageToDoc] Name conflict detected, adding timestamp');
          
          if (Utilities && Session) {
            const timeTag = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "_HHmmss");
            const newName = fileName.replace(/(\.[\w\d_-]+)$/i, timeTag + '$1');
            fileName = (newName === fileName) ? fileName + timeTag : newName;
          } else {
            // Test environment - simple timestamp
            const timeTag = '_' + Date.now();
            const newName = fileName.replace(/(\.[\w\d_-]+)$/i, timeTag + '$1');
            fileName = (newName === fileName) ? fileName + timeTag : newName;
          }
          
          if (newFileBlob.setName) {
            newFileBlob.setName(fileName);
          }
          console.log('[processMessageToDoc] Renamed to:', fileName);
        }
        
        console.log('[processMessageToDoc] Saving new file:', fileName);
        const file = folder.createFile(newFileBlob);
        body.insertParagraph(currentIndex++, "- " + file.getName());
        console.log('[processMessageToDoc] File saved successfully');
      }
    });
  }
  
  // Insert separator - use thread separator for bottom message (oldest, first in sorted array) if threadId provided
  const { threadId, isBottomMessage } = options;
  if (threadId && isBottomMessage) {
    const separator = `------------------------------[THREAD:${threadId}]`;
    body.insertParagraph(currentIndex++, separator);
    console.log('[processMessageToDoc] Added thread separator:', threadId);
  } else {
    body.insertParagraph(currentIndex++, "------------------------------");
  }
  
  // Pause in GAS environment to prevent crashes
  if (Utilities) {
    Utilities.sleep(500);
  }
  
  return currentIndex;
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
  const { threadId } = options;
  
  // If threadId is provided, remove any existing content for this thread
  if (threadId) {
    removeExistingThread(body, threadId);
  }
  
  // Sort messages by date (oldest first) so when we prepend (insert at index 0),
  // the newest messages end up at the top of the document
  const sortedMessages = messages.slice().sort(function(a, b) {
    return a.getDate().getTime() - b.getDate().getTime();
  });
  
  sortedMessages.forEach((message, msgIndex) => {
    console.log('[processMessagesToDoc] Processing message', msgIndex + 1, 'of', sortedMessages.length);
    // The first message in sorted array (oldest) will be inserted last and end up at bottom
    // So it should get the thread separator
    const isBottomMessage = (msgIndex === 0);
    processMessageToDoc(message, body, folder, { ...options, isBottomMessage });
  });
  
  return sortedMessages.length;
}

/**
 * Sort threads by their last message date in reverse chronological order (newest first).
 * This ensures threads are always processed in the correct order regardless of how
 * the Gmail API returns them or when they were labeled.
 * 
 * @param {Array} threads - Array of Gmail thread objects
 * @returns {Array} Sorted array of threads (newest first)
 */
function sortThreadsByLastMessageDate(threads) {
  return threads.slice().sort(function(a, b) {
    const aMessages = a.getMessages();
    const bMessages = b.getMessages();
    const aLastDate = aMessages[aMessages.length - 1].getDate().getTime();
    const bLastDate = bMessages[bMessages.length - 1].getDate().getTime();
    return bLastDate - aLastDate; // Descending order (newest first)
  });
}

module.exports = { processMessageToDoc, processMessagesToDoc, sortThreadsByLastMessageDate, removeExistingThread };
