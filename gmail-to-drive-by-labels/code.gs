/**
 * Main function to trigger the processing of emails.
 * Reads settings from Config.gs
 */
function storeEmailsAndAttachments() {
  var PROCESS_CONFIG = getProcessConfig();

  PROCESS_CONFIG.forEach(config => {
    processLabelGroup(config);
  });
}

/**
 * Processes a single configuration group (Label -> Doc + Folder).
 */
function processLabelGroup(config) {
  var triggerLabelName = config.triggerLabel;
  var processedLabelName = config.processedLabel;

  // 1. Validate Labels
  var triggerLabel = GmailApp.getUserLabelByName(triggerLabelName);
  var processedLabel = GmailApp.getUserLabelByName(processedLabelName);
  
  // Create processed label if it doesn't exist
  if (!processedLabel) {
    try {
      processedLabel = GmailApp.createLabel(processedLabelName);
    } catch(e) {
      Logger.log("Could not create label: " + processedLabelName);
    }
  }

  if (!triggerLabel) {
    Logger.log("Trigger label not found: " + triggerLabelName);
    return;
  }

  // 2. Get Threads
  var threads = triggerLabel.getThreads();
  if (!threads || threads.length === 0) {
    Logger.log("No emails found for: " + triggerLabelName);
    return;
  }

  // 3. Open Destination Doc and Folder
  try {
    var doc = DocumentApp.openById(config.docId);
    var body = doc.getBody();
    var folder = DriveApp.getFolderById(config.folderId);
  } catch (e) {
    Logger.log("Error opening Doc or Folder. Check IDs in Config.gs. Error: " + e.message);
    return;
  }

  // 4. Process Emails
  threads.forEach(thread => {
    var messages = thread.getMessages();
    
    messages.forEach(message => {
      var subject = message.getSubject();
      var rawContent = message.getPlainBody();
      
      // Clean Content (removes replies, quote lines, and legal footers)
      var cleanContent = getCleanBody(rawContent);
      
      var timestamp = message.getDate();
      
      Logger.log("Processing: " + subject);

      // --- A. Append Text to Doc ---
      var subjectText = "Subject: " + (subject ? subject : "(No Subject)");
      var headingPara = body.appendParagraph(subjectText);
      
      // Try to set heading, fallback to bold if Doc is busy
      try {
        headingPara.setHeading(DocumentApp.ParagraphHeading.HEADING_3);
      } catch (e) {
        var style = {};
        style[DocumentApp.Attribute.BOLD] = true;
        headingPara.setAttributes(style);
      }
      
      body.appendParagraph("Date: " + timestamp);
      body.appendParagraph(cleanContent);

      // --- B. Save Attachments (CONTENT-BASED DEDUPLICATION) ---
      var attachments = message.getAttachments();
      if (attachments.length > 0) {
        body.appendParagraph("[Attachments]:"); 
        
        attachments.forEach(att => {
          var fileName = att.getName();
          var newFileBlob = att.copyBlob();
          var isDuplicate = false;
          
          // 1. Get all files in folder with this name
          var existingFiles = folder.getFilesByName(fileName);
          
          while (existingFiles.hasNext()) {
            var existingFile = existingFiles.next();
            
            // 2. Fast Fail: Compare sizes first
            if (existingFile.getSize() === newFileBlob.getBytes().length) {
              
              // 3. Deep Check: Compare MD5 Hashes (The "Fingerprint")
              var existingHash = getFileHash(existingFile.getBlob());
              var newHash = getFileHash(newFileBlob);
              
              if (existingHash === newHash) {
                isDuplicate = true;
                break; // Stop checking, we found the twin
              }
            }
          }
          
          if (isDuplicate) {
             Logger.log("Skipping exact duplicate: " + fileName);
             body.appendParagraph("- [DUPLICATE SKIPPED] " + fileName);
          } else {
             // It's a new file (or a file with same name but different content)
             
             // If name exists but content is different, rename to avoid overwrite
             if (folder.getFilesByName(fileName).hasNext()) {
               var timeTag = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "_HHmmss");
               // Insert timestamp before the file extension
               var newName = fileName.replace(/(\.[\w\d_-]+)$/i, timeTag + '$1'); 
               // Fallback if regex fails (files without extension)
               if(newName === fileName) newName += timeTag;
               
               newFileBlob.setName(newName);
               fileName = newName; // Update for log
             }

             var file = folder.createFile(newFileBlob);
             body.appendParagraph("- " + file.getName());
          }
        });
      }
      body.appendParagraph("------------------------------");
      
      // Pause briefly to allow Google Doc to save (prevents crash)
      Utilities.sleep(500);
    });

    // 5. Cleanup Labels
    triggerLabel.removeFromThread(thread);
    if(processedLabel) processedLabel.addToThread(thread);
  });
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
