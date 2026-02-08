/**
 * Gmail to Drive processing utilities.
 * 
 * Designed to be testable outside of Google Apps Script by accepting
 * objects that match the minimal interfaces used.
 */

const { getCleanBody, getFileHash } = require('../../gas-utils');

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
  
  // Insert separator
  body.insertParagraph(currentIndex++, "------------------------------");
  
  // Pause in GAS environment to prevent crashes
  if (Utilities) {
    Utilities.sleep(500);
  }
  
  return currentIndex;
}

/**
 * Process multiple messages from a thread, prepending them to the document.
 * Messages are sorted by date (oldest first) so newest appear at top.
 * 
 * @param {Array} messages - Array of Gmail message objects
 * @param {Object} body - Document body object
 * @param {Object} folder - Drive folder object
 * @param {Object} options - Optional settings for GAS environment
 * @returns {number} Total number of messages processed
 */
function processMessagesToDoc(messages, body, folder, options = {}) {
  // Sort messages by date (oldest first) so when we prepend (insert at index 0),
  // the newest messages end up at the top of the document
  const sortedMessages = messages.slice().sort(function(a, b) {
    return a.getDate().getTime() - b.getDate().getTime();
  });
  
  sortedMessages.forEach((message, msgIndex) => {
    console.log('[processMessagesToDoc] Processing message', msgIndex + 1, 'of', sortedMessages.length);
    processMessageToDoc(message, body, folder, options);
  });
  
  return sortedMessages.length;
}

module.exports = { processMessageToDoc, processMessagesToDoc };
