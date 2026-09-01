/**
 * Google Apps Script Engine for Tag-Based Gmail Retention & Taxonomy Automation
 * Thin wrapper that injects global GAS services into retention logic from retention-logic.gs
 */

function runGmailRetentionAutomation() {
  Logger.log('Starting Gmail Tag-Based Retention Automation...')
  const config = getRetentionConfig()

  classifyAndTagThreads(config.classificationRules, GmailApp, Logger)
  executeRetentionRules(config.executionRules, GmailApp, Logger)

  Logger.log('Gmail Tag-Based Retention Automation cycle completed!')
}

function createHourlyTrigger() {
  createAndManageTrigger(ScriptApp, Logger, 'runGmailRetentionAutomation')
}
