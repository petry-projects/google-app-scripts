/**
 * Main function to trigger the processing of emails.
 * Reads settings from Config.gs
 */
function storeEmailsAndAttachments() {
  console.log('[storeEmailsAndAttachments] Starting email processing');
  var PROCESS_CONFIG = getProcessConfig();
  console.log('[storeEmailsAndAttachments] Processing', PROCESS_CONFIG.length, 'configurations');

  PROCESS_CONFIG.forEach((config, index) => {
    console.log('[storeEmailsAndAttachments] Processing config', index + 1, 'of', PROCESS_CONFIG.length, ':', config.triggerLabel);
    processLabelGroup(config);
  });
  console.log('[storeEmailsAndAttachments] Completed all processing');
}

/**
 * Rebuilds all configured documents by clearing them and reprocessing all emails.
 * This function:
 * 1. Clears the configured Google Doc
 * 2. Moves all processed/archived emails back to the trigger label
 * 3. Allows storeEmailsAndAttachments() to reprocess them
 * 
 * For large label sets, this function uses batching to avoid timeouts.
 * If interrupted, run again to continue from where it left off.
 * 
 * Run this when you've updated getCleanBody() or other processing logic
 * and want to regenerate the documents with the new logic.
 */
function rebuildAllDocs() {
  console.log('[rebuildAllDocs] Starting rebuild process');
  var PROCESS_CONFIG = getProcessConfig();
  console.log('[rebuildAllDocs] Rebuilding', PROCESS_CONFIG.length, 'configurations');
  
  var completed = true;
  for (var i = 0; i < PROCESS_CONFIG.length; i++) {
    var config = PROCESS_CONFIG[i];
    console.log('[rebuildAllDocs] Rebuilding config', i + 1, 'of', PROCESS_CONFIG.length, ':', config.triggerLabel);
    var configCompleted = rebuildDoc(config);
    if (!configCompleted) {
      console.log('[rebuildAllDocs] Paused due to time constraints. Run rebuildAllDocs() again to continue.');
      completed = false;
      break;
    }
  }
  
  if (completed) {
    console.log('[rebuildAllDocs] Rebuild preparation complete.');
    console.log('[rebuildAllDocs] Now run storeEmailsAndAttachments() to reprocess all emails.');
  }
}

/**
 * Rebuilds a single document by clearing it and moving processed emails back to trigger label.
 * Uses batching and state tracking to handle large label sets without timing out.
 * Returns true if completed, false if needs to continue in another execution.
 */
function rebuildDoc(config) {
  var MAX_EXECUTION_TIME = 4 * 60 * 1000; // 4 minutes (leaving 2 min buffer for 6 min limit)
  var BATCH_SIZE = 100; // Process 100 threads at a time
  var startTime = new Date().getTime();
  
  console.log('[rebuildDoc] Starting rebuild for:', config.triggerLabel);
  
  var triggerLabelName = config.triggerLabel;
  var processedLabelName = config.processedLabel;
  var stateKey = 'rebuild_state_' + triggerLabelName.replace(/[^a-zA-Z0-9]/g, '_');
  
  // 1. Validate and get labels
  console.log('[rebuildDoc] Looking up labels');
  var triggerLabel = GmailApp.getUserLabelByName(triggerLabelName);
  var processedLabel = GmailApp.getUserLabelByName(processedLabelName);
  
  if (!triggerLabel) {
    console.error('[rebuildDoc] Trigger label not found:', triggerLabelName);
    Logger.log("Trigger label not found: " + triggerLabelName);
    return true; // Nothing to do, consider complete
  }
  
  if (!processedLabel) {
    console.log('[rebuildDoc] Processed label not found:', processedLabelName, '- nothing to unarchive');
  }
  
  // 2. Check if we need to clear the document (only on first run)
  var properties = PropertiesService.getUserProperties();
  var rebuildState = properties.getProperty(stateKey);
  var state = rebuildState ? JSON.parse(rebuildState) : { phase: 'clear_doc' };
  
  if (state.phase === 'clear_doc') {
    console.log('[rebuildDoc] Clearing document:', config.docId);
    try {
      var doc = DocumentApp.openById(config.docId);
      var body = doc.getBody();
      
      // Clear all content from the document body in a single operation
      body.setText('');
      console.log('[rebuildDoc] Document cleared');
      
      // Move to next phase
      state.phase = 'move_emails';
      properties.setProperty(stateKey, JSON.stringify(state));
    } catch (e) {
      console.error('[rebuildDoc] Error clearing document:', e.message);
      Logger.log("Error clearing document: " + e.message);
      properties.deleteProperty(stateKey);
      return true; // Error, consider done to avoid infinite loop
    }
  }
  
  // 3. Move emails from processed label back to trigger label (batched)
  if (state.phase === 'move_emails' && processedLabel) {
    console.log('[rebuildDoc] Moving processed emails back to trigger label');
    
    var allThreads = processedLabel.getThreads();
    var totalThreads = allThreads.length;
    console.log('[rebuildDoc] Found', totalThreads, 'processed threads remaining');
    
    if (totalThreads === 0) {
      // No threads to process, we're done
      properties.deleteProperty(stateKey);
      console.log('[rebuildDoc] No threads to move');
      console.log('[rebuildDoc] Rebuild complete for:', config.triggerLabel);
      console.log('[rebuildDoc] Run storeEmailsAndAttachments() to reprocess these emails');
      return true;
    }
    
    // Process threads in batches, always starting from index 0
    // (since we're removing threads as we go, the array shrinks)
    var threadsToProcess = Math.min(BATCH_SIZE, totalThreads);
    var threadsProcessed = 0;
    
    for (var i = 0; i < threadsToProcess; i++) {
      // Check if we're approaching time limit
      var elapsed = new Date().getTime() - startTime;
      if (elapsed > MAX_EXECUTION_TIME) {
        console.log('[rebuildDoc] Approaching time limit, saving progress. Processed', threadsProcessed, 'threads this run');
        properties.setProperty(stateKey, JSON.stringify(state));
        return false; // Not completed, need another run
      }
      
      var thread = allThreads[i];
      triggerLabel.addToThread(thread);
      processedLabel.removeFromThread(thread);
      threadsProcessed++;
      
      if ((i + 1) % 10 === 0 || i === threadsToProcess - 1) {
        console.log('[rebuildDoc] Moved', i + 1, 'of', threadsToProcess, 'threads in this batch');
      }
    }
    
    console.log('[rebuildDoc] Processed', threadsProcessed, 'threads in this batch,', totalThreads - threadsToProcess, 'remaining');
    
    if (threadsToProcess >= totalThreads) {
      // All threads processed
      properties.deleteProperty(stateKey);
      console.log('[rebuildDoc] Moved all threads back to trigger label');
      console.log('[rebuildDoc] Rebuild complete for:', config.triggerLabel);
      console.log('[rebuildDoc] Run storeEmailsAndAttachments() to reprocess these emails');
      return true;
    } else {
      // More threads to process
      properties.setProperty(stateKey, JSON.stringify(state));
      console.log('[rebuildDoc] Batch complete. Run rebuildAllDocs() again to continue.');
      return false;
    }
  }
  
  // If we got here with no processed label, we're done
  properties.deleteProperty(stateKey);
  console.log('[rebuildDoc] Rebuild complete for:', config.triggerLabel);
  console.log('[rebuildDoc] Run storeEmailsAndAttachments() to reprocess these emails');
  return true;
}

/**
 * Processes a single configuration group (Label -> Doc + Folder).
 */
function processLabelGroup(config) {
  console.log('[processLabelGroup] Starting processing for:', config.triggerLabel);
  var triggerLabelName = config.triggerLabel;
  var processedLabelName = config.processedLabel;

  // 1. Validate Labels
  console.log('[processLabelGroup] Looking up trigger label:', triggerLabelName);
  var triggerLabel = GmailApp.getUserLabelByName(triggerLabelName);
  var processedLabel = GmailApp.getUserLabelByName(processedLabelName);
  
  // Create processed label if it doesn't exist
  if (!processedLabel) {
    console.log('[processLabelGroup] Processed label not found, creating:', processedLabelName);
    try {
      processedLabel = GmailApp.createLabel(processedLabelName);
      console.log('[processLabelGroup] Created label:', processedLabelName);
    } catch(e) {
      Logger.log("Could not create label: " + processedLabelName);
      console.error('[processLabelGroup] Error creating label:', e.message);
    }
  }

  if (!triggerLabel) {
    Logger.log("Trigger label not found: " + triggerLabelName);
    console.error('[processLabelGroup] Trigger label not found:', triggerLabelName);
    return;
  }

  // 2. Get Threads
  console.log('[processLabelGroup] Retrieving threads for label:', triggerLabelName);
  var threads = triggerLabel.getThreads();
  if (!threads || threads.length === 0) {
    Logger.log("No emails found for: " + triggerLabelName);
    console.log('[processLabelGroup] No threads found for label:', triggerLabelName);
    return;
  }
  console.log('[processLabelGroup] Found', threads.length, 'threads to process');

  // 3. Open Destination Doc and Folder
  console.log('[processLabelGroup] Opening doc:', config.docId, 'and folder:', config.folderId);
  try {
    var doc = DocumentApp.openById(config.docId);
    var body = doc.getBody();
    var folder = DriveApp.getFolderById(config.folderId);
    console.log('[processLabelGroup] Successfully opened doc and folder');
  } catch (e) {
    Logger.log("Error opening Doc or Folder. Check IDs in Config.gs. Error: " + e.message);
    console.error('[processLabelGroup] Error opening Doc/Folder:', e.message);
    return;
  }

  // 4. Process Emails
  var totalMessages = 0;
  threads.forEach((thread, threadIndex) => {
    var messages = thread.getMessages();
    console.log('[processLabelGroup] Thread', threadIndex + 1, 'has', messages.length, 'messages');
    
    // Sort messages by date (oldest first) so when we prepend (insert at index 0),
    // the newest messages end up at the top of the document
    messages.sort(function(a, b) {
      return a.getDate().getTime() - b.getDate().getTime();
    });
    
    messages.forEach((message, msgIndex) => {
      totalMessages++;
      var subject = message.getSubject();
      var rawContent = message.getPlainBody();
      
      // Clean Content (removes replies, quote lines, and legal footers)
      var cleanContent = getCleanBody(rawContent);
      console.log('[processLabelGroup] Cleaned content length:', cleanContent.length, 'chars (from', rawContent.length, ')');
      
      var timestamp = message.getDate();
      
      Logger.log("Processing: " + subject);
      console.log('[processLabelGroup] Processing message', msgIndex + 1, ':', subject);

      // --- A. Prepend Text to Doc (insert at top, newest first) ---
      // Note: currentIndex starts at 0 for each message, so each new message
      // is inserted at the top of the document, pushing previous content down.
      // This ensures the most recent emails appear first.
      var currentIndex = 0;
      
      var subjectText = "Subject: " + (subject ? subject : "(No Subject)");
      var headingPara = body.insertParagraph(currentIndex++, subjectText);
      
      // Try to set heading, fallback to bold if Doc is busy
      try {
        headingPara.setHeading(DocumentApp.ParagraphHeading.HEADING_3);
      } catch (e) {
        var style = {};
        style[DocumentApp.Attribute.BOLD] = true;
        headingPara.setAttributes(style);
      }
      
      body.insertParagraph(currentIndex++, "Date: " + timestamp);
      body.insertParagraph(currentIndex++, cleanContent);

      // --- B. Save Attachments (CONTENT-BASED DEDUPLICATION) ---
      var attachments = message.getAttachments();
      console.log('[processLabelGroup] Found', attachments.length, 'attachments');
      if (attachments.length > 0) {
        body.insertParagraph(currentIndex++, "[Attachments]:"); 
        
        attachments.forEach((att, attIndex) => {
          console.log('[processLabelGroup] Processing attachment', attIndex + 1, 'of', attachments.length, ':', att.getName());
          var fileName = att.getName();
          var newFileBlob = att.copyBlob();
          var isDuplicate = false;
          
          // 1. Get all files in folder with this name
          var existingFiles = folder.getFilesByName(fileName);
          console.log('[processLabelGroup] Checking for existing files named:', fileName);
          
          var existingCount = 0;
          while (existingFiles.hasNext()) {
            existingCount++;
            var existingFile = existingFiles.next();
            console.log('[processLabelGroup] Comparing with existing file', existingCount);
            
            // 2. Fast Fail: Compare sizes first
            if (existingFile.getSize() === newFileBlob.getBytes().length) {
              console.log('[processLabelGroup] Size match, checking hash');
              
              // 3. Deep Check: Compare MD5 Hashes (The "Fingerprint")
              var existingHash = getFileHash(existingFile.getBlob());
              var newHash = getFileHash(newFileBlob);
              
              if (existingHash === newHash) {
                console.log('[processLabelGroup] Hash match - duplicate detected');
                isDuplicate = true;
                break; // Stop checking, we found the twin
              } else {
                console.log('[processLabelGroup] Hash mismatch - different content');
              }
            } else {
              console.log('[processLabelGroup] Size mismatch - different file');
            }
          }
          
          if (isDuplicate) {
             Logger.log("Skipping exact duplicate: " + fileName);
             console.log('[processLabelGroup] Skipping duplicate:', fileName);
             body.insertParagraph(currentIndex++, "- [DUPLICATE SKIPPED] " + fileName);
          } else {
             // It's a new file (or a file with same name but different content)
             
             // If name exists but content is different, rename to avoid overwrite
             if (folder.getFilesByName(fileName).hasNext()) {
               console.log('[processLabelGroup] Name conflict detected, adding timestamp');
               var timeTag = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "_HHmmss");
               // Insert timestamp before the file extension
               var newName = fileName.replace(/(\.[\w\d_-]+)$/i, timeTag + '$1'); 
               // Fallback if regex fails (files without extension)
               if(newName === fileName) newName += timeTag;
               
               newFileBlob.setName(newName);
               fileName = newName; // Update for log
               console.log('[processLabelGroup] Renamed to:', fileName);
             }

             console.log('[processLabelGroup] Saving new file:', fileName);
             var file = folder.createFile(newFileBlob);
             body.insertParagraph(currentIndex++, "- " + file.getName());
             console.log('[processLabelGroup] File saved successfully');
          }
        });
      }
      body.insertParagraph(currentIndex++, "------------------------------");
      
      // Pause briefly to allow Google Doc to save (prevents crash)
      Utilities.sleep(500);
    });

    // 5. Cleanup Labels
    console.log('[processLabelGroup] Updating labels for thread');
    triggerLabel.removeFromThread(thread);
    if(processedLabel) processedLabel.addToThread(thread);
  });
  console.log('[processLabelGroup] Processed', totalMessages, 'total messages');
  console.log('[processLabelGroup] Completed processing for:', config.triggerLabel);
}

/**
 * Helper function to remove quoted replies, specific line patterns, and footers.
 */
function getCleanBody(text) {
  if (!text) return "";

  // 1. FIRST PASS: Cut off at headers or footers
  var headerPatterns = [
    /^\s*On\s+.+\s+wrote:/m,           // Gmail Reply Header
    /^\s*From:\s+.+\s+Sent:\s+/m,      // Outlook Reply Header
    /^\s*_{10,}/m,                     // Underscore Separators
    /^\s*From:\s+.+<.+@.+>/m,          // Generic Header
    /confidentiality notice/im         // Legal Footer (Case Insensitive)
  ];

  var splitIndex = -1;

  headerPatterns.forEach(pattern => {
    var match = text.match(pattern);
    if (match) {
      if (splitIndex === -1 || match.index < splitIndex) {
        splitIndex = match.index;
      }
    }
  });

  var workingText = (splitIndex !== -1) ? text.substring(0, splitIndex) : text;

  // 2. SECOND PASS: Line Sweeper (Removes lines starting with > or <)
  var lines = workingText.split('\n');
  var cleanLines = lines.filter(function(line) {
    var trimmed = line.trim();
    // Returns FALSE (removes line) if it starts with > or <
    return !(trimmed.startsWith(">") || trimmed.startsWith("<"));
  });

  return cleanLines.join('\n').trim();
}

/**
 * Generates an MD5 hash (fingerprint) for a file blob.
 * Returns a string representing the binary content.
 */
function getFileHash(blob) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, blob.getBytes());
  return digest.map(function(byte) {
    return ('0' + (byte & 0xFF).toString(16)).slice(-2);
  }).join('');
}

// Export functions for testing (Node.js only)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { rebuildDoc, rebuildAllDocs, processLabelGroup, storeEmailsAndAttachments };
}
