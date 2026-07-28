// @version 1.0.0
/**
 * Main entry point for AI-Powered Semantic Email Classification and Auto-Filter Generation.
 *
 * Business logic lives in src/index.js (testable with Jest). This file is the
 * thin GAS entry point that wires GAS globals into the extracted functions.
 */
function processEmailsWithAiClassifier() {
  console.log(
    '[processEmailsWithAiClassifier] Starting AI semantic email processing'
  )
  var config = getAiClassifierConfig()

  var threads = GmailApp.search(config.unprocessedQuery, 0, 15)
  threads.sort(function (a, b) {
    return a.getLastMessageDate() - b.getLastMessageDate()
  })
  console.log(
    '[processEmailsWithAiClassifier] Found',
    threads.length,
    'unprocessed threads'
  )

  if (threads.length === 0) {
    return
  }

  var results = processThreadBatch(threads, config, {
    GmailApp: GmailApp,
    UrlFetchApp: UrlFetchApp,
    Gmail: typeof Gmail !== 'undefined' ? Gmail : null,
  })

  console.log(
    '[processEmailsWithAiClassifier] AI processing batch completed. Results:',
    results.length
  )
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { processEmailsWithAiClassifier }
}
