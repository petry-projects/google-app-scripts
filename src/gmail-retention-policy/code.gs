/**
 * Google Apps Script Engine for Tag-Based Gmail Retention & Taxonomy Automation
 * Sanitized Open-Source Template (100% PII Redacted)
 */

function runGmailRetentionAutomation() {
  Logger.log('Starting Gmail Tag-Based Retention Automation...')
  var config = getRetentionConfig()

  // Stage 1: Classify & Tag Threads
  classifyAndTagThreads_(config.classificationRules)

  // Stage 2: Execute Retention Purges & Inbox Auto-Archiving
  executeRetentionRules_(config.executionRules)

  Logger.log('Gmail Tag-Based Retention Automation cycle completed!')
}

function classifyAndTagThreads_(rules) {
  var maxThreads = 50

  for (var i = 0; i < rules.length; i++) {
    var rule = rules[i]
    var taxLabel = getOrCreateLabel_(rule.taxonomyLabel)
    var retLabel = getOrCreateLabel_(rule.retentionTag)

    var q = '(' + rule.query + ') -label:"' + rule.taxonomyLabel + '"'
    var threads = GmailApp.search(q, 0, maxThreads)

    if (threads.length > 0) {
      Logger.log(
        'Tagging ' +
          threads.length +
          ' threads with [' +
          rule.taxonomyLabel +
          '] + [' +
          rule.retentionTag +
          ']...'
      )
      taxLabel.addToThreads(threads)
      retLabel.addToThreads(threads)
    }
  }
}

function executeRetentionRules_(execRules) {
  for (var i = 0; i < execRules.length; i++) {
    var execRule = execRules[i]
    var threads = GmailApp.search(execRule.query, 0, 50)

    if (threads.length > 0) {
      if (execRule.action === 'trash') {
        Logger.log(
          'Trashing ' + threads.length + ' threads for ' + execRule.tag + '...'
        )
        for (var t = 0; t < threads.length; t++) {
          threads[t].moveToTrash()
        }
      } else if (execRule.action === 'archive') {
        Logger.log(
          'Archiving ' +
            threads.length +
            ' threads out of Inbox for ' +
            execRule.tag +
            '...'
        )
        for (var t = 0; t < threads.length; t++) {
          threads[t].removeFromInbox()
        }
      }
    }
  }
}

function createHourlyTrigger() {
  var existingTriggers = ScriptApp.getProjectTriggers()
  for (var i = 0; i < existingTriggers.length; i++) {
    if (
      existingTriggers[i].getHandlerFunction() === 'runGmailRetentionAutomation'
    ) {
      ScriptApp.deleteTrigger(existingTriggers[i])
      Logger.log('Removed old trigger.')
    }
  }

  ScriptApp.newTrigger('runGmailRetentionAutomation')
    .timeBased()
    .everyHours(1)
    .create()

  Logger.log('SUCCESS: Hourly trigger created!')
}

function getOrCreateLabel_(labelName) {
  var label = GmailApp.getUserLabelByName(labelName)
  if (!label) {
    Logger.log('Creating new label: ' + labelName)
    label = GmailApp.createLabel(labelName)
  }
  return label
}
