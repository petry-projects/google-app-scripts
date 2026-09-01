/**
 * Shared retention logic for both GAS and test environments.
 * Functions are injected with GAS services as parameters for testability.
 */

function processRulesForThreads(
  rules,
  gmailApp,
  logger,
  searchModifier,
  handler
) {
  const maxThreads = 50
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]
    const query = searchModifier(rule)
    const threads = gmailApp.search(query, 0, maxThreads)
    if (threads.length > 0) {
      handler(rule, threads, logger, gmailApp)
    }
  }
}

function classifyAndTagThreads(rules, gmailApp, logger) {
  processRulesForThreads(
    rules,
    gmailApp,
    logger,
    function (rule) {
      return '(' + rule.query + ') -label:"' + rule.taxonomyLabel + '"'
    },
    function (rule, threads, logger, gmailApp) {
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
  )
}

function executeRetentionRules(execRules, gmailApp, logger) {
  processRulesForThreads(
    execRules,
    gmailApp,
    logger,
    function (rule) {
      return rule.query
    },
    function (rule, threads, logger) {
      if (rule.action === 'trash') {
        logger.log(
          'Trashing ' + threads.length + ' threads for ' + rule.tag + '...'
        )
        for (let t = 0; t < threads.length; t++) {
          threads[t].moveToTrash()
        }
      } else if (rule.action === 'archive') {
        logger.log(
          'Archiving ' +
            threads.length +
            ' threads out of Inbox for ' +
            rule.tag +
            '...'
        )
        for (let t = 0; t < threads.length; t++) {
          threads[t].removeFromInbox()
        }
      }
    }
  )
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

module.exports = {
  classifyAndTagThreads,
  executeRetentionRules,
  getOrCreateLabel,
  createAndManageTrigger,
  processRulesForThreads,
}
