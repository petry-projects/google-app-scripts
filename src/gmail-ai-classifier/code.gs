// @version 1.0.0
/**
 * Main entry point for AI-Powered Semantic Email Classification and Auto-Filter Generation.
 */
function processEmailsWithAiClassifier() {
  console.log('[processEmailsWithAiClassifier] Starting AI semantic email processing');
  var config = getAiClassifierConfig();

  var threads = GmailApp.search(config.unprocessedQuery, 0, 15);
  console.log('[processEmailsWithAiClassifier] Found', threads.length, 'unprocessed threads');

  if (threads.length === 0) {
    return;
  }

  var processedLabel = ensureUserLabel(config.processedLabel);

  threads.forEach(function (thread, index) {
    console.log('[processEmailsWithAiClassifier] Processing thread', index + 1, 'of', threads.length);
    var messages = thread.getMessages();
    if (!messages || messages.length === 0) return;

    var latestMsg = messages[messages.length - 1];
    var sender = latestMsg.getFrom();
    var subject = latestMsg.getSubject();
    var bodySnippet = latestMsg.getPlainBody() ? latestMsg.getPlainBody().substring(0, 1200) : '';

    var classification = classifyWithGemini(config, sender, subject, bodySnippet);
    if (!classification || !classification.canonical_label) {
      console.log('[processEmailsWithAiClassifier] Could not classify thread:', thread.getId());
      return;
    }

    console.log('[processEmailsWithAiClassifier] Classified as:', classification.canonical_label, '(Confidence:', classification.confidence, ')');

    // 1. Apply Canonical Category Label (Preserves INBOX visibility)
    var categoryLabel = ensureUserLabel(classification.canonical_label);
    thread.addLabel(categoryLabel);

    // 2. Apply Single Global Processed Marker Label
    thread.addLabel(processedLabel);

    // 3. Auto-Create Permanent Gmail Filter Rule if Confidence >= Threshold
    if (classification.confidence >= config.autoFilterConfidenceThreshold) {
      createGmailFilterRule(sender, classification.canonical_label);
    }
  });

  console.log('[processEmailsWithAiClassifier] AI processing batch completed');
}

/**
 * Calls Gemini REST API natively via UrlFetchApp
 */
function classifyWithGemini(config, sender, subject, bodyText) {
  var url = config.modelEndpoint + '?key=' + config.geminiApiKey;

  var prompt = 'You are an executive email classifier.\n' +
    'Classify the following email into exactly ONE of these canonical domain labels:\n' +
    config.canonicalDomains.join('\n') + '\n\n' +
    'Email Details:\n' +
    'Sender: ' + sender + '\n' +
    'Subject: ' + subject + '\n' +
    'Body Snippet: ' + bodyText + '\n\n' +
    'Respond ONLY in JSON format matching this schema:\n' +
    '{"canonical_label": "Domain/Subfolder", "confidence": 0.98, "reasoning": "short explanation"}';

  var payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { response_mime_type: 'application/json' }
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    var jsonText = response.getContentText();
    var parsed = JSON.parse(jsonText);
    var outputText = parsed.candidates[0].content.parts[0].text;
    return JSON.parse(outputText);
  } catch (e) {
    console.error('[classifyWithGemini] Error calling Gemini REST API:', e.message);
    return null;
  }
}

/**
 * Creates permanent static Gmail filter rule via Advanced Gmail Service API
 */
function createGmailFilterRule(senderEmail, labelName) {
  try {
    var cleanSender = senderEmail.replace(/.*<(.+)>/, '$1').trim();
    var targetLabel = ensureUserLabel(labelName);

    var filterBody = {
      criteria: { from: cleanSender },
      action: { addLabelIds: [targetLabel.getId()] }
    };

    if (typeof Gmail !== 'undefined' && Gmail.Users && Gmail.Users.Settings && Gmail.Users.Settings.Filters) {
      Gmail.Users.Settings.Filters.create(filterBody, 'me');
      console.log('[createGmailFilterRule] Permanent Gmail filter created for:', cleanSender, '->', labelName);
    } else {
      console.log('[createGmailFilterRule] Advanced Gmail service not enabled. Auto-filter creation skipped.');
    }
  } catch (e) {
    console.error('[createGmailFilterRule] Error creating filter:', e.message);
  }
}

/**
 * Helper to ensure a Gmail user label exists
 */
function ensureUserLabel(labelName) {
  var existing = GmailApp.getUserLabelByName(labelName);
  if (existing) return existing;
  try {
    return GmailApp.createLabel(labelName);
  } catch (e) {
    console.error('[ensureUserLabel] Error creating label:', labelName, e.message);
    return null;
  }
}
