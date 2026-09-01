/**
 * Google Apps Script Engine for Tag-Based Gmail Retention & Taxonomy Automation
 * Thin wrapper that injects global GAS services into retention logic from retention-logic.gs
 *
 * Coverage note: This file is a GAS entry point that delegates to tested functions in
 * retention-logic.gs. The functions here are called by Google Apps Script's time-based
 * triggers and are not tested directly, but the logic they call is 100% tested.
 */
/* c8 ignore start */

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
/* c8 ignore stop */
