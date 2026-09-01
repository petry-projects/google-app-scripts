/**
 * Testable business logic for tag-based Gmail retention automation
 * GAS services (GmailApp, ScriptApp, Logger) are injected as parameters
 */

function classifyAndTagThreads(rules, gmailApp, logger) {
  const maxThreads = 50

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]
    const q = '(' + rule.query + ') -label:"' + rule.taxonomyLabel + '"'
    const threads = gmailApp.search(q, 0, maxThreads)

    if (threads.length > 0) {
      logger.log(
        'Tagging ' +
          threads.length +
          ' threads with [' +
          rule.taxonomyLabel +
          '] + [' +
          rule.retentionTag +
          ']...'
      )

      const taxLabel = getOrCreateLabel(rule.taxonomyLabel, gmailApp, logger)
      const retLabel = getOrCreateLabel(rule.retentionTag, gmailApp, logger)

      taxLabel.addToThreads(threads)
      retLabel.addToThreads(threads)
    }
  }
}

function executeRetentionRules(execRules, gmailApp, logger) {
  for (let i = 0; i < execRules.length; i++) {
    const execRule = execRules[i]
    const threads = gmailApp.search(execRule.query, 0, 50)

    if (threads.length > 0) {
      if (execRule.action === 'trash') {
        logger.log(
          'Trashing ' + threads.length + ' threads for ' + execRule.tag + '...'
        )
        for (let t = 0; t < threads.length; t++) {
          threads[t].moveToTrash()
        }
      } else if (execRule.action === 'archive') {
        logger.log(
          'Archiving ' +
            threads.length +
            ' threads out of Inbox for ' +
            execRule.tag +
            '...'
        )
        for (let t = 0; t < threads.length; t++) {
          threads[t].removeFromInbox()
        }
      }
    }
  }
}

function getOrCreateLabel(labelName, gmailApp, logger) {
  let label = gmailApp.getUserLabelByName(labelName)
  if (!label) {
    logger.log('Creating new label: ' + labelName)
    label = gmailApp.createLabel(labelName)
  }
  return label
}

function createAndManageTrigger(scriptApp, logger, handlerFunction) {
  const existingTriggers = scriptApp.getProjectTriggers()
  for (let i = 0; i < existingTriggers.length; i++) {
    if (existingTriggers[i].getHandlerFunction() === handlerFunction) {
      scriptApp.deleteTrigger(existingTriggers[i])
      logger.log('Removed old trigger.')
    }
  }

  scriptApp.newTrigger(handlerFunction).timeBased().everyHours(1).create()

  logger.log('SUCCESS: Hourly trigger created!')
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    classifyAndTagThreads,
    executeRetentionRules,
    getOrCreateLabel,
    createAndManageTrigger,
  }
}
