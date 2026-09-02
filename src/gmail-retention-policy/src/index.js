/**
 * Shared retention logic for both GAS and test environments.
 * Functions are injected with GAS services as parameters for testability.
 * NOSONAR — similar function structure is intentional for readability and maintainability
 */

function processRulesForThreads(
  rules,
  gmailApp,
  logger,
  searchModifier,
  handler
) {
  const maxThreads = 50
  for (const rule of rules) {
    const query = searchModifier(rule)
    const threads = gmailApp.search(query, 0, maxThreads)
    if (threads.length > 0) {
      threads.sort((a, b) => b.getLastMessageDate() - a.getLastMessageDate())
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
    function (rule, threads, logger, gmailApp) {
      if (rule.action === 'trash') {
        logger.log(
          'Trashing ' + threads.length + ' threads for ' + rule.tag + '...'
        )
        gmailApp.moveThreadsToTrash(threads)
      } else if (rule.action === 'archive') {
        logger.log(
          'Archiving ' +
            threads.length +
            ' threads out of Inbox for ' +
            rule.tag +
            '...'
        )
        gmailApp.moveThreadsToArchive(threads)
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
  for (const trigger of existingTriggers) {
    if (trigger.getHandlerFunction() === handlerFunction) {
      scriptApp.deleteTrigger(trigger)
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
