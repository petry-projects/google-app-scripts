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
